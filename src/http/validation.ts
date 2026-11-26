import type { z, ZodError, ZodType } from "zod"

import type { Reply, Request } from "./app.ts"

export type ValidationIssue = {
  // Caminho do campo ("content", "tags.0"); null quando o erro é no valor inteiro (ex.: body ausente)
  field: string | null
  message: string
}

// Uma entrada por problema encontrado pelo zod
export function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : null,
    message: issue.message
  }))
}

// Falha de validação: o handler central responde 400 com `{ message, errors }`
export class ValidationError extends Error {
  zodError: ZodError

  constructor(zodError: ZodError, message = "Invalid request") {
    super(message)
    this.name = "ValidationError"
    this.zodError = zodError
  }

  get issues(): ValidationIssue[] {
    return toValidationIssues(this.zodError)
  }
}

// Resposta 400 padrão para falhas de validação do zod, com uma entrada por problema encontrado.
// Uso: `if (!parsed.success) return sendValidationError(res, parsed.error)`
export function sendValidationError(res: Reply, error: ZodError, message = "Invalid request") {
  return res.status(400).send({ message, errors: toValidationIssues(error) })
}

function parseWith<S extends ZodType>(value: unknown, schema: S, message: string): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ValidationError(parsed.error, message)
  return parsed.data
}

// Valida um valor avulso (ex.: um path param). Lança ValidationError quando é inválido.
export function parseValue<S extends ZodType>(value: unknown, schema: S, message: string) {
  return parseWith(value, schema, message)
}

export function parseBody<S extends ZodType>(
  req: Request<unknown>,
  schema: S,
  message = "Invalid request body"
) {
  return parseWith(req.body, schema, message)
}

// Converte a query string em objeto antes de validar. Com parâmetro repetido vale o primeiro,
// como em `URLSearchParams.get()`.
export function parseQuery<S extends ZodType>(
  req: Request<unknown>,
  schema: S,
  message = "Invalid query parameters"
) {
  const query = new Map<string, string>()
  for (const [key, value] of req.query) {
    if (!query.has(key)) query.set(key, value)
  }

  return parseWith(Object.fromEntries(query), schema, message)
}

// Os nomes dos headers já chegam em minúsculas; o z.object descarta os que não estão no schema
export function parseHeaders<S extends ZodType>(
  req: Request<unknown>,
  schema: S,
  message = "Invalid headers"
) {
  return parseWith(req.headers, schema, message)
}
