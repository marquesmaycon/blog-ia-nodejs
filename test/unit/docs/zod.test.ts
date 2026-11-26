import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { z } from "zod"

import {
  headerParams,
  jsonBody,
  jsonSchema,
  pathParam,
  queryParams
} from "../../../src/docs/zod.ts"

describe("jsonSchema", () => {
  it("remove o $schema e os limites de inteiro seguro injetados pelo .int()", () => {
    assert.deepEqual(jsonSchema(z.number().int()), { type: "integer" })
    assert.deepEqual(jsonSchema(z.number().int().min(1).max(10)), {
      type: "integer",
      minimum: 1,
      maximum: 10
    })
  })

  it("documenta a entrada de transform e coerce, não a saída", () => {
    const schema = z.object({
      q: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || undefined),
      page: z.coerce.number().int().min(1).default(1)
    })

    assert.deepEqual(jsonSchema(schema), {
      type: "object",
      properties: {
        q: { type: "string", maxLength: 200 },
        page: { type: "integer", minimum: 1, default: 1 }
      }
    })
  })

  it("documenta nullable como anyOf com null", () => {
    assert.deepEqual(jsonSchema(z.string().max(5).nullable()), {
      anyOf: [{ type: "string", maxLength: 5 }, { type: "null" }]
    })
  })
})

describe("queryParams", () => {
  it("gera um parâmetro por campo, com required, description e example", () => {
    const schema = z.object({
      status: z.enum(["a", "b"]),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      tag: z.string().optional().meta({ description: "Slug da tag", example: "node-js" })
    })

    assert.deepEqual(queryParams(schema), [
      { name: "status", in: "query", required: true, schema: { type: "string", enum: ["a", "b"] } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 50, default: 10 }
      },
      {
        name: "tag",
        in: "query",
        required: false,
        description: "Slug da tag",
        schema: { type: "string", example: "node-js" }
      }
    ])
  })

  it("leva a description de um campo com transform", () => {
    const schema = z.object({
      q: z
        .string()
        .optional()
        .transform((value) => value || undefined)
        .meta({ description: "Busca" })
    })

    assert.equal(queryParams(schema)[0].description, "Busca")
  })
})

describe("headerParams", () => {
  it("usa o nome canônico do header", () => {
    const [param] = headerParams(z.object({ "x-visitor-id": z.string().regex(/^[a-z]+$/) }))

    assert.deepEqual(param, {
      name: "X-Visitor-Id",
      in: "header",
      required: true,
      schema: { type: "string", pattern: "^[a-z]+$" }
    })
  })
})

describe("pathParam", () => {
  it("é sempre obrigatório e sobe a description", () => {
    assert.deepEqual(pathParam("slug", z.string().max(100).meta({ description: "Slug do post" })), {
      name: "slug",
      in: "path",
      required: true,
      description: "Slug do post",
      schema: { type: "string", maxLength: 100 }
    })
  })
})

describe("jsonBody", () => {
  it("monta o requestBody JSON obrigatório por padrão", () => {
    assert.deepEqual(jsonBody(z.object({ idea: z.string().min(1) })), {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { idea: { type: "string", minLength: 1 } },
            required: ["idea"]
          }
        }
      }
    })
  })

  it("aceita body opcional e descarta o default do prefault", () => {
    const body = jsonBody(z.object({ count: z.number().default(5) }).prefault({}), {
      required: false
    })

    assert.equal(body.required, false)
    assert.deepEqual(body.content["application/json"].schema, {
      type: "object",
      properties: { count: { type: "number", default: 5 } }
    })
  })
})
