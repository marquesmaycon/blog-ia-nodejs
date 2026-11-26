import assert from "node:assert/strict"
import { describe, it } from "node:test"

import request from "supertest"
import { z } from "zod"

import { createApp } from "../../../src/http/app.ts"
import {
  parseBody,
  parseHeaders,
  parseQuery,
  parseValue,
  sendValidationError
} from "../../../src/http/validation.ts"

const schema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string())
})

function buildServer(message?: string) {
  const app = createApp()
  app.post("/", (req, res) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, message)
    return res.send({ ok: true })
  })
  return app.server
}

describe("sendValidationError", () => {
  it("responde 400 com um erro por campo, com o caminho completo", async () => {
    const res = await request(buildServer())
      .post("/")
      .send({ name: "", tags: ["ok", 1] })

    assert.equal(res.status, 400)
    assert.deepEqual(res.body, {
      message: "Invalid request",
      errors: [
        { field: "name", message: "Too small: expected string to have >=1 characters" },
        { field: "tags.1", message: "Invalid input: expected string, received number" }
      ]
    })
  })

  it("usa field null quando o erro é no valor inteiro", async () => {
    const res = await request(buildServer("Invalid request body")).post("/")

    assert.deepEqual(res.body, {
      message: "Invalid request body",
      errors: [{ field: null, message: "Invalid input: expected object, received undefined" }]
    })
  })
})

describe("helpers de parse", () => {
  const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    q: z.string().optional()
  })

  function buildParseServer() {
    const app = createApp()
    app.post("/body", (req) => parseBody(req, schema))
    app.get("/query", (req) => parseQuery(req, querySchema))
    app.get("/headers", (req) => parseHeaders(req, z.object({ "x-visitor-id": z.string().min(8) })))
    app.get("/value/:slug", (req) =>
      parseValue(req.params.slug, z.string().regex(/^[a-z]+$/), "Invalid slug")
    )
    return app.server
  }

  describe("parseBody", () => {
    it("devolve o body validado", async () => {
      const res = await request(buildParseServer())
        .post("/body")
        .send({ name: "a", tags: [], extra: 1 })

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { name: "a", tags: [] })
    })

    it("responde 400 com 'Invalid request body' por padrão", async () => {
      const res = await request(buildParseServer()).post("/body")

      assert.equal(res.status, 400)
      assert.deepEqual(res.body, {
        message: "Invalid request body",
        errors: [{ field: null, message: "Invalid input: expected object, received undefined" }]
      })
    })
  })

  describe("parseQuery", () => {
    it("converte a query string e aplica os defaults", async () => {
      const res = await request(buildParseServer()).get("/query?q=node")

      assert.deepEqual(res.body, { page: 1, q: "node" })
    })

    it("usa o primeiro valor quando o parâmetro se repete", async () => {
      const res = await request(buildParseServer()).get("/query?page=2&page=3")

      assert.deepEqual(res.body, { page: 2 })
    })

    it("não confunde parâmetros com chaves do protótipo", async () => {
      const res = await request(buildParseServer()).get("/query?constructor=x&q=a")

      assert.deepEqual(res.body, { page: 1, q: "a" })
    })

    it("responde 400 com 'Invalid query parameters' por padrão", async () => {
      const res = await request(buildParseServer()).get("/query?page=0")

      assert.equal(res.status, 400)
      assert.equal(res.body.message, "Invalid query parameters")
      assert.equal(res.body.errors[0].field, "page")
    })
  })

  describe("parseHeaders", () => {
    it("devolve só os headers do schema", async () => {
      const res = await request(buildParseServer()).get("/headers").set("X-Visitor-Id", "abcdefgh")

      assert.deepEqual(res.body, { "x-visitor-id": "abcdefgh" })
    })

    it("responde 400 com 'Invalid headers' quando o header falta", async () => {
      const res = await request(buildParseServer()).get("/headers")

      assert.equal(res.status, 400)
      assert.equal(res.body.message, "Invalid headers")
      assert.equal(res.body.errors[0].field, "x-visitor-id")
    })
  })

  describe("parseValue", () => {
    it("devolve o valor válido", async () => {
      const res = await request(buildParseServer()).get("/value/node")

      assert.equal(res.text, "node")
    })

    it("responde 400 com a mensagem informada", async () => {
      const res = await request(buildParseServer()).get("/value/Node-1")

      assert.equal(res.status, 400)
      assert.equal(res.body.message, "Invalid slug")
      assert.equal(res.body.errors[0].field, null)
    })
  })
})
