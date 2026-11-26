import assert from "node:assert/strict"
import { describe, it, mock } from "node:test"

import request from "supertest"
import { z } from "zod"

import { createApp, HttpError } from "../../../src/http/app.ts"
import { forbidden, notFound } from "../../../src/http/errors.ts"
import { ValidationError } from "../../../src/http/validation.ts"

describe("createApp", () => {
  describe("roteamento", () => {
    it("responde 404 para rota inexistente", async () => {
      const app = createApp()

      const res = await request(app.server).get("/nope")

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Not Found" })
    })

    it("responde 404 quando o path existe mas o método não", async () => {
      const app = createApp()
      app.get("/posts", () => ({ ok: true }))

      const res = await request(app.server).post("/posts")

      assert.equal(res.status, 404)
    })

    it("extrai e decodifica os path params", async () => {
      const app = createApp()
      app.get("/posts/:id/comments/:commentId", (req) => req.params)

      const res = await request(app.server).get("/posts/a%20b/comments/42")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { id: "a b", commentId: "42" })
    })

    it("responde 404 quando o param tem encoding inválido", async () => {
      const app = createApp()
      app.get("/posts/:id", (req) => req.params)

      const res = await request(app.server).get("/posts/%E0%A4%A")

      assert.equal(res.status, 404)
    })

    it("ignora barras extras no path", async () => {
      const app = createApp()
      app.get("/posts/:id", (req) => req.params)

      const res = await request(app.server).get("/posts/1/")

      assert.deepEqual(res.body, { id: "1" })
    })

    it("prioriza segmento estático sobre param, independente da ordem de registro", async () => {
      const app = createApp()
      app.get("/posts/:id", () => "param")
      app.get("/posts/draft", () => "static")

      const draft = await request(app.server).get("/posts/draft")
      const other = await request(app.server).get("/posts/123")

      assert.equal(draft.text, "static")
      assert.equal(other.text, "param")
    })

    it("expõe a query string como URLSearchParams", async () => {
      const app = createApp()
      app.get("/search", (req) => ({ q: req.query.get("q"), missing: req.query.get("x") }))

      const res = await request(app.server).get("/search?q=node")

      assert.deepEqual(res.body, { q: "node", missing: null })
    })
  })

  describe("body", () => {
    it("faz parse do JSON em métodos com body", async () => {
      const app = createApp()
      app.post("/echo", (req) => ({ body: req.body }))

      const res = await request(app.server).post("/echo").send({ idea: "testes" })

      assert.deepEqual(res.body, { body: { idea: "testes" } })
    })

    it("deixa o body undefined quando a requisição vem vazia", async () => {
      const app = createApp()
      app.post("/echo", (req) => ({ isUndefined: req.body === undefined }))

      const res = await request(app.server).post("/echo")

      assert.deepEqual(res.body, { isUndefined: true })
    })

    it("não lê body em GET", async () => {
      const app = createApp()
      app.get("/echo", (req) => ({ isUndefined: req.body === undefined }))

      const res = await request(app.server).get("/echo")

      assert.deepEqual(res.body, { isUndefined: true })
    })

    it("responde 400 para JSON inválido sem chamar o handler", async () => {
      const app = createApp()
      const handler = mock.fn()
      app.post("/echo", handler)

      const res = await request(app.server)
        .post("/echo")
        .set("Content-Type", "application/json")
        .send("{invalid")

      assert.equal(res.status, 400)
      assert.deepEqual(res.body, { message: "Invalid JSON body" })
      assert.equal(handler.mock.callCount(), 0)
    })
  })

  describe("resposta", () => {
    it("envia o valor retornado pelo handler como JSON", async () => {
      const app = createApp()
      app.get("/json", () => ({ data: [1, 2] }))

      const res = await request(app.server).get("/json")

      assert.equal(res.status, 200)
      assert.match(res.headers["content-type"], /application\/json/)
      assert.deepEqual(res.body, { data: [1, 2] })
    })

    it("envia string como text/plain", async () => {
      const app = createApp()
      app.get("/text", () => "hello")

      const res = await request(app.server).get("/text")

      assert.match(res.headers["content-type"], /text\/plain/)
      assert.equal(res.text, "hello")
    })

    it("permite encadear status e header", async () => {
      const app = createApp()
      app.post("/created", (_req, res) => res.status(201).header("X-Custom", "1").send({ ok: 1 }))

      const res = await request(app.server).post("/created")

      assert.equal(res.status, 201)
      assert.equal(res.headers["x-custom"], "1")
      assert.deepEqual(res.body, { ok: 1 })
    })

    it("envia resposta sem corpo quando send() é chamado sem payload", async () => {
      const app = createApp()
      app.delete("/empty", (_req, res) => res.status(204).send())

      const res = await request(app.server).delete("/empty")

      assert.equal(res.status, 204)
      assert.equal(res.text, "")
    })

    it("ignora o retorno do handler quando a resposta já foi enviada", async () => {
      const app = createApp()
      app.get("/twice", (_req, res) => {
        res.send({ first: true })
        return { second: true }
      })

      const res = await request(app.server).get("/twice")

      assert.deepEqual(res.body, { first: true })
    })

    it("responde 500 quando o handler lança um erro", async (t) => {
      const consoleError = t.mock.method(console, "error", () => {})
      const app = createApp()
      app.get("/boom", () => {
        throw new Error("boom")
      })

      const res = await request(app.server).get("/boom")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Internal Server Error" })
      assert.equal(consoleError.mock.callCount(), 1)
    })
  })

  describe("tratamento de erros", () => {
    it("responde HttpError com o status e a mensagem, sem logar", async (t) => {
      const consoleError = t.mock.method(console, "error", () => {})
      const app = createApp()
      app.get("/missing", () => {
        throw notFound("Post not found")
      })

      const res = await request(app.server).get("/missing")

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
      assert.equal(consoleError.mock.callCount(), 0)
    })

    it("inclui os details do HttpError na resposta", async () => {
      const app = createApp()
      app.post("/reply", () => {
        throw new HttpError(422, "Not answerable", { reason: "Fora do tema" })
      })

      const res = await request(app.server).post("/reply")

      assert.equal(res.status, 422)
      assert.deepEqual(res.body, { message: "Not answerable", reason: "Fora do tema" })
    })

    it("responde ValidationError com 400 e um erro por campo", async () => {
      const app = createApp()
      app.post("/validate", () => {
        const parsed = z.object({ name: z.string() }).safeParse({})
        if (!parsed.success) throw new ValidationError(parsed.error, "Invalid request body")
      })

      const res = await request(app.server).post("/validate")

      assert.equal(res.status, 400)
      assert.deepEqual(res.body, {
        message: "Invalid request body",
        errors: [{ field: "name", message: "Invalid input: expected string, received undefined" }]
      })
    })

    it("usa a mensagem e o log do onError da rota para erros inesperados", async (t) => {
      const consoleError = t.mock.method(console, "error", () => {})
      const error = new Error("db down")
      const app = createApp()
      app.get(
        "/posts",
        () => {
          throw error
        },
        { onError: { message: "Failed to list posts", log: "Falha ao listar os posts:" } }
      )

      const res = await request(app.server).get("/posts")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to list posts" })
      assert.deepEqual(consoleError.mock.calls[0].arguments, ["Falha ao listar os posts:", error])
    })

    it("usa o status do onError quando informado", async (t) => {
      t.mock.method(console, "error", () => {})
      const app = createApp()
      app.post(
        "/draft",
        () => {
          throw new Error("llm down")
        },
        { onError: { message: "Failed to generate post", log: "Falha:", status: 502 } }
      )

      const res = await request(app.server).post("/draft")

      assert.equal(res.status, 502)
      assert.deepEqual(res.body, { message: "Failed to generate post" })
    })

    it("não aplica o onError a HttpError nem a ValidationError", async () => {
      const app = createApp()
      const onError = { message: "Failed", log: "Falha:" }
      app.get("/forbidden", () => Promise.reject(forbidden()), { onError })

      const res = await request(app.server).get("/forbidden")

      assert.equal(res.status, 403)
      assert.deepEqual(res.body, { message: "Forbidden" })
    })
  })
})
