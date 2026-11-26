// Testa as rotas de tags isoladamente: a camada de services é substituída por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import type { Post } from "../../../src/domain/posts.ts"
import type { TagWithCount } from "../../../src/domain/tags.ts"

const post: Post = {
  id: "post-1",
  slug: "titulo",
  title: "Título",
  reading_time_minutes: 1,
  content: "Conteúdo",
  summary: null,
  meta_description: null,
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: null,
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: [{ name: "Node.js", slug: "node-js" }]
}

const tagWithCount: TagWithCount = { name: "Node.js", slug: "node-js", posts_count: 2 }

const services = {
  setPostTags: mock.fn(async (_postId: string, _names: string[]): Promise<Post | null> => post),
  listTags: mock.fn(async (): Promise<TagWithCount[]> => [tagWithCount]),
  deleteTag: mock.fn(async (_slug: string): Promise<boolean> => true)
}

mock.module(import.meta.resolve("../../../src/services/tags.ts"), { exports: services })

const { createApp } = await import("../../../src/http/app.ts")
const { registerTagRoutes } = await import("../../../src/routes/tags.ts")

const auth = { Authorization: "Bearer secret" }

function buildServer() {
  const app = createApp()
  registerTagRoutes(app)
  return app.server
}

const putTags = (postId: string, body?: unknown) =>
  request(buildServer())
    .put(`/posts/${postId}/tags`)
    .set(auth)
    .send(body as object)

const failing = async () => {
  throw new Error("db down")
}

describe("rotas de tags", () => {
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

  describe("GET /tags", () => {
    it("é público e lista as tags com contagem", async () => {
      const res = await request(buildServer()).get("/tags")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: [tagWithCount] })
    })

    it("responde 500 quando o service falha", async () => {
      services.listTags.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).get("/tags")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to list tags" })
    })
  })

  describe("rotas administrativas exigem API key", () => {
    const adminRoutes = [
      {
        name: "PUT /posts/:id/tags",
        send: () =>
          request(buildServer())
            .put("/posts/post-1/tags")
            .send({ tags: ["IA"] }),
        service: services.setPostTags
      },
      {
        name: "DELETE /tags/:slug",
        send: () => request(buildServer()).delete("/tags/node-js"),
        service: services.deleteTag
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

    it("PUT /posts/:id/tags checa a API key antes de validar o body", async () => {
      const res = await request(buildServer()).put("/posts/post-1/tags").send({})

      assert.equal(res.status, 403)
    })
  })

  describe("PUT /posts/:id/tags", () => {
    it("substitui as tags (com trim) e devolve o post", async () => {
      const res = await putTags("post-1", { tags: ["  Node.js  ", "IA"] })

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Post tags updated", data: post })
      assert.deepEqual(services.setPostTags.mock.calls[0].arguments, ["post-1", ["Node.js", "IA"]])
    })

    it("aceita lista vazia para remover todas as tags", async () => {
      const res = await putTags("post-1", { tags: [] })

      assert.equal(res.status, 200)
      assert.deepEqual(services.setPostTags.mock.calls[0].arguments, ["post-1", []])
    })

    const invalidBodies: [string, unknown, string | null][] = [
      ["sem body", undefined, null],
      ["sem o campo tags", {}, "tags"],
      ["com tags que não é lista", { tags: "IA" }, "tags"],
      ["com mais de 10 tags", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, "tags"],
      ["com tag vazia", { tags: ["IA", "   "] }, "tags.1"],
      ["com tag longa demais", { tags: ["x".repeat(41)] }, "tags.0"],
      ["com tag sem letras nem dígitos", { tags: ["!!!"] }, "tags.0"],
      ["com tag que não é string", { tags: [42] }, "tags.0"]
    ]

    for (const [name, body, field] of invalidBodies) {
      it(`responde 400 ${name}`, async () => {
        const res = await putTags("post-1", body)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid request body")
        assert.equal(res.body.errors[0].field, field)
        assert.equal(services.setPostTags.mock.callCount(), 0)
      })
    }

    it("responde 404 quando o post não existe", async () => {
      services.setPostTags.mock.mockImplementationOnce(async () => null)

      const res = await putTags("missing", { tags: [] })

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.setPostTags.mock.mockImplementationOnce(failing)

      const res = await putTags("post-1", { tags: [] })

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to update post tags" })
    })
  })

  describe("DELETE /tags/:slug", () => {
    it("apaga a tag", async () => {
      const res = await request(buildServer()).delete("/tags/node-js").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Tag deleted" })
      assert.deepEqual(services.deleteTag.mock.calls[0].arguments, ["node-js"])
    })

    it("responde 404 quando a tag não existe", async () => {
      services.deleteTag.mock.mockImplementationOnce(async () => false)

      const res = await request(buildServer()).delete("/tags/missing").set(auth)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Tag not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.deleteTag.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).delete("/tags/node-js").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to delete tag" })
    })
  })
})
