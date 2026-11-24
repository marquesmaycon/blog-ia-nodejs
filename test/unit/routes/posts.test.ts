// Testa as rotas isoladamente: a camada de services é substituída por mocks,
// então nenhum acesso a banco ou LLM acontece. Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import type { Post } from "../../../src/repositories/posts.ts"

const services = {
  listPosts: mock.fn(async (_options?: { includeAll?: boolean }): Promise<Post[]> => []),
  getPost: mock.fn(async (_id: string): Promise<Post | null> => null),
  approvePost: mock.fn(async (_id: string): Promise<Post | null> => null),
  rejectPost: mock.fn(async (_id: string): Promise<Post | null> => null),
  createPostDraft: mock.fn(async (_idea: string): Promise<Post> => post)
}

mock.module(import.meta.resolve("../../../src/services/posts.ts"), { exports: services })

const { createApp } = await import("../../../src/http/app.ts")
const { registerPostRoutes } = await import("../../../src/routes/posts.ts")

const post: Post = {
  id: "abc",
  title: "Título",
  content: "Conteúdo",
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: null,
  rejected_at: null
}

const auth = { Authorization: "Bearer secret" }

function buildServer() {
  const app = createApp()
  registerPostRoutes(app)
  return app.server
}

describe("rotas /posts", () => {
  const originalApiKey = process.env.API_KEY

  beforeEach(() => {
    process.env.API_KEY = "secret"
    for (const fn of Object.values(services)) fn.mock.resetCalls()
    // Silencia os console.error dos caminhos de erro
    mock.method(console, "error", () => {})
  })

  afterEach(() => {
    mock.restoreAll()
    if (originalApiKey === undefined) delete process.env.API_KEY
    else process.env.API_KEY = originalApiKey
  })

  describe("GET /posts", () => {
    it("lista apenas aprovados por padrão", async () => {
      services.listPosts.mock.mockImplementationOnce(async () => [post])

      const res = await request(buildServer()).get("/posts")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: [post] })
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [{ includeAll: false }])
    })

    it("lista todos com include=all e API key válida", async () => {
      const res = await request(buildServer())
        .get("/posts?include=all")
        .set("Authorization", "Bearer secret")

      assert.equal(res.status, 200)
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [{ includeAll: true }])
    })

    it("responde 403 com include=all sem API key", async () => {
      const res = await request(buildServer()).get("/posts?include=all")

      assert.equal(res.status, 403)
      assert.equal(services.listPosts.mock.callCount(), 0)
    })

    it("responde 403 com include=all e API key inválida", async () => {
      const res = await request(buildServer())
        .get("/posts?include=all")
        .set("Authorization", "Bearer wrong")

      assert.equal(res.status, 403)
    })

    it("responde 400 para valor inválido de include", async () => {
      const res = await request(buildServer()).get("/posts?include=drafts")

      assert.equal(res.status, 400)
      assert.deepEqual(res.body, { message: "Invalid value for 'include'" })
    })

    it("responde 500 quando o service falha", async () => {
      services.listPosts.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).get("/posts")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to list posts" })
    })
  })

  describe("rotas administrativas exigem API key", () => {
    const adminRoutes = [
      {
        name: "PATCH /posts/:id/approve",
        send: () => request(buildServer()).patch("/posts/abc/approve"),
        service: services.approvePost
      },
      {
        name: "DELETE /posts/:id/reject",
        send: () => request(buildServer()).delete("/posts/abc/reject"),
        service: services.rejectPost
      },
      {
        name: "POST /posts/draft",
        send: () => request(buildServer()).post("/posts/draft").send({ idea: "testes" }),
        service: services.createPostDraft
      }
    ]

    for (const { name, send, service } of adminRoutes) {
      it(`${name} responde 403 sem API key e não chama o service`, async () => {
        const res = await send()

        assert.equal(res.status, 403)
        assert.deepEqual(res.body, { message: "Forbidden" })
        assert.equal(service.mock.callCount(), 0)
      })

      it(`${name} responde 403 com API key inválida`, async () => {
        const res = await send().set("Authorization", "Bearer wrong")

        assert.equal(res.status, 403)
        assert.equal(service.mock.callCount(), 0)
      })
    }

    it("POST /posts/draft checa a API key antes de validar o body", async () => {
      const res = await request(buildServer()).post("/posts/draft").send({})

      assert.equal(res.status, 403)
    })
  })

  describe("GET /posts/:id", () => {
    it("retorna o post encontrado", async () => {
      services.getPost.mock.mockImplementationOnce(async () => post)

      const res = await request(buildServer()).get("/posts/abc")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: post })
      assert.deepEqual(services.getPost.mock.calls[0].arguments, ["abc"])
    })

    it("responde 404 quando o post não existe", async () => {
      const res = await request(buildServer()).get("/posts/missing")

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.getPost.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).get("/posts/abc")

      assert.equal(res.status, 500)
    })
  })

  describe("PATCH /posts/:id/approve", () => {
    it("aprova o post", async () => {
      const approved = { ...post, approved_at: "2026-01-02T00:00:00.000Z" }
      services.approvePost.mock.mockImplementationOnce(async () => approved)

      const res = await request(buildServer()).patch("/posts/abc/approve").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Post approved", data: approved })
      assert.deepEqual(services.approvePost.mock.calls[0].arguments, ["abc"])
    })

    it("responde 404 quando o post não existe", async () => {
      const res = await request(buildServer()).patch("/posts/missing/approve").set(auth)

      assert.equal(res.status, 404)
    })

    it("responde 500 quando o service falha", async () => {
      services.approvePost.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).patch("/posts/abc/approve").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to approve post" })
    })
  })

  describe("DELETE /posts/:id/reject", () => {
    it("reprova o post", async () => {
      const rejected = { ...post, rejected_at: "2026-01-02T00:00:00.000Z" }
      services.rejectPost.mock.mockImplementationOnce(async () => rejected)

      const res = await request(buildServer()).delete("/posts/abc/reject").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Post rejected", data: rejected })
    })

    it("responde 404 quando o post não existe", async () => {
      const res = await request(buildServer()).delete("/posts/missing/reject").set(auth)

      assert.equal(res.status, 404)
    })

    it("responde 500 quando o service falha", async () => {
      services.rejectPost.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).delete("/posts/abc/reject").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to reject post" })
    })
  })

  describe("POST /posts/draft", () => {
    it("cria o rascunho a partir da ideia (com trim)", async () => {
      const res = await request(buildServer())
        .post("/posts/draft")
        .set(auth)
        .send({ idea: "  testes  " })

      assert.equal(res.status, 201)
      assert.deepEqual(res.body, { message: "Post draft created", data: post })
      assert.deepEqual(services.createPostDraft.mock.calls[0].arguments, ["testes"])
    })

    for (const [name, body] of [
      ["sem body", undefined],
      ["sem o campo idea", {}],
      ["com idea vazia", { idea: "   " }],
      ["com idea que não é string", { idea: 123 }]
    ] as const) {
      it(`responde 400 ${name}`, async () => {
        const res = await request(buildServer()).post("/posts/draft").set(auth).send(body)

        assert.equal(res.status, 400)
        assert.deepEqual(res.body, { message: "Field 'idea' is required" })
        assert.equal(services.createPostDraft.mock.callCount(), 0)
      })
    }

    it("responde 502 quando a geração falha", async () => {
      services.createPostDraft.mock.mockImplementationOnce(async () => {
        throw new Error("LLM indisponível")
      })

      const res = await request(buildServer())
        .post("/posts/draft")
        .set(auth)
        .send({ idea: "testes" })

      assert.equal(res.status, 502)
      assert.deepEqual(res.body, { message: "Failed to generate post" })
    })
  })
})
