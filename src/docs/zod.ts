// Gera pedaços da spec OpenAPI (parâmetros e request bodies) a partir dos schemas zod das rotas,
// para os limites, defaults e padrões ficarem num lugar só.

import { z, type ZodObject, type ZodType } from "zod"

export type JsonSchema = Record<string, unknown>

export type Parameter = {
  name: string
  in: "query" | "header" | "path"
  required: boolean
  description?: string
  schema: JsonSchema
}

// Remove o que o z.toJSONSchema adiciona e não faz sentido na spec: o `$schema` e os limites
// de inteiro seguro que o `.int()` injeta quando não há min/max explícito
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean)
  if (node === null || typeof node !== "object") return node

  const result: JsonSchema = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue
    if (key === "maximum" && value === Number.MAX_SAFE_INTEGER) continue
    if (key === "minimum" && value === Number.MIN_SAFE_INTEGER) continue
    result[key] = clean(value)
  }
  return result
}

// `io: "input"`: com transform/coerce, documenta o que o cliente envia, não o valor já convertido
export function jsonSchema(schema: ZodType): JsonSchema {
  return clean(z.toJSONSchema(schema, { io: "input" })) as JsonSchema
}

// A `description` sobe do schema para o parâmetro, onde a Swagger UI a exibe
function toParameter(
  name: string,
  location: Parameter["in"],
  required: boolean,
  schema: JsonSchema
): Parameter {
  const { description, ...rest } = schema
  return {
    name,
    in: location,
    required,
    ...(typeof description === "string" ? { description } : {}),
    schema: rest
  }
}

function objectParams(
  schema: ZodObject,
  location: "query" | "header",
  rename: (name: string) => string = (name) => name
): Parameter[] {
  const { properties = {}, required = [] } = jsonSchema(schema) as {
    properties?: Record<string, JsonSchema>
    required?: string[]
  }

  return Object.entries(properties).map(([name, property]) =>
    toParameter(rename(name), location, required.includes(name), property)
  )
}

// Um parâmetro de query por campo do objeto; campos com default ou optional não são obrigatórios
export function queryParams(schema: ZodObject): Parameter[] {
  return objectParams(schema, "query")
}

// "x-visitor-id" -> "X-Visitor-Id": o schema usa minúsculas porque o Node entrega os headers assim
function canonicalHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-")
}

export function headerParams(schema: ZodObject): Parameter[] {
  return objectParams(schema, "header", canonicalHeaderName)
}

export function pathParam(name: string, schema: ZodType): Parameter {
  return toParameter(name, "path", true, jsonSchema(schema))
}

// O `default` do topo sai: um `.prefault({})` (body ausente vale como objeto vazio) já aparece
// como `required: false` no requestBody
export function jsonBody(schema: ZodType, { required = true }: { required?: boolean } = {}) {
  const { default: _default, ...bodySchema } = jsonSchema(schema)
  return {
    required,
    content: { "application/json": { schema: bodySchema } }
  }
}
