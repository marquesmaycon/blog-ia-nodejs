// Testa as rotas de curtidas isoladamente: a camada de services é substituída por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import type { PopularPost } from "../../../src/domain/posts.ts"
import type { LikeResult, PopularPostsQuery } from "../../../src/services/likes.ts"

const popular: PopularPost = {
  id: "post-1",
  slug: "titulo",
  title: "Título",
  reading_time_minutes: 1,
  content: "Conteúdo",
  summary: null,
  meta_description: null,
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: "2026-01-01T00:00:00.000Z",
  rejected_at: null,
  likes_count: 3,
  comments_count: 1,
  tags: [],
  recent_likes: 2
}

const services = {
  likePost: mock.fn(async (_postId: string, _visitorId: string): Promise<LikeResult | null> => ({
    created: true,
    likes_count: 1
  })),
  unlikePost: mock.fn(
    async (_postId: string, _visitorId: string): Promise<{ likes_count: number } | null> => ({
      likes_count: 0
    })
  ),
  listPopularPosts: mock.fn(async (_query: PopularPostsQuery): Promise<PopularPost[]> => [popular])
}

mock.module(import.meta.resolve("../../../src/services/likes.ts"), { exports: services })

const { createApp } = await import("../../../src/http/app.ts")
const { registerLikeRoutes } = await import("../../../src/routes/likes.ts")

const VISITOR_ID = "V1StGXR8_Z5jdHi6B-myT"
const visitor = { "X-Visitor-Id": VISITOR_ID }

function buildServer() {
  const app = createApp()
  // Uma rota /posts/:id concorrente prova que /posts/popular tem prioridade
  app.get("/posts/:id", () => ({ data: "post" }))
  registerLikeRoutes(app)
  return app.server
}

function buildLimitedServer() {
  const app = createApp()
  registerLikeRoutes(app, { rateLimit: { max: 2, windowMs: 60_000 } })
  return app.server
}

const failing = async () => {
  throw new Error("db down")
}

const INVALID_VISITOR_IDS = ["curto", "tem espaço no meio", "x".repeat(65)]

const INVALID_POPULAR_QUERIES = [
  ["days=0", "days"],
  ["days=366", "days"],
  ["days=1.5", "days"],
  ["limit=0", "limit"],
  ["limit=51", "limit"],
  ["limit=abc", "limit"]
]

describe("rotas de curtidas", () => {
  beforeEach(() => {
    for (const fn of Object.values(services)) fn.mock.resetCalls()
    services.likePost.mock.mockImplementation(async () => ({ created: true, likes_count: 1 }))
    services.unlikePost.mock.mockImplementation(async () => ({ likes_count: 0 }))
    services.listPopularPosts.mock.mockImplementation(async () => [popular])
    mock.method(console, "error", () => {})
  })

  afterEach(() => mock.restoreAll())

  for (const method of ["post", "delete"] as const) {
    describe(`${method.toUpperCase()} /posts/:id/likes: validação do visitante`, () => {
      it("responde 400 sem X-Visitor-Id, sem chamar o service", async () => {
        const res = await request(buildServer())[method]("/posts/post-1/likes")

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid headers")
        assert.equal(res.body.errors[0].field, "x-visitor-id")
        assert.equal(services.likePost.mock.callCount() + services.unlikePost.mock.callCount(), 0)
      })

      for (const invalid of INVALID_VISITOR_IDS) {
        it(`responde 400 para X-Visitor-Id inválido (${invalid.slice(0, 20)})`, async () => {
          const call = request(buildServer())[method]("/posts/post-1/likes")
          const res = await call.set("X-Visitor-Id", invalid)

          assert.equal(res.status, 400)
          assert.equal(res.body.errors[0].field, "x-visitor-id")
        })
      }
    })
  }

  describe("POST /posts/:id/likes", () => {
    it("responde 201 na primeira curtida", async () => {
      const res = await request(buildServer()).post("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 201)
      assert.deepEqual(res.body, {
        message: "Post liked",
        data: { post_id: "post-1", liked: true, likes_count: 1 }
      })
      assert.deepEqual(services.likePost.mock.calls[0].arguments, ["post-1", VISITOR_ID])
    })

    it("responde 200 quando o visitante já tinha curtido", async () => {
      services.likePost.mock.mockImplementation(async () => ({ created: false, likes_count: 1 }))

      const res = await request(buildServer()).post("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, {
        message: "Post already liked",
        data: { post_id: "post-1", liked: true, likes_count: 1 }
      })
    })

    it("responde 404 quando o post não está publicado", async () => {
      services.likePost.mock.mockImplementation(async () => null)

      const res = await request(buildServer()).post("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.likePost.mock.mockImplementation(failing)

      const res = await request(buildServer()).post("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to like post" })
    })
  })

  describe("DELETE /posts/:id/likes", () => {
    it("remove a curtida e devolve o total", async () => {
      const res = await request(buildServer()).delete("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, {
        message: "Like removed",
        data: { post_id: "post-1", liked: false, likes_count: 0 }
      })
      assert.deepEqual(services.unlikePost.mock.calls[0].arguments, ["post-1", VISITOR_ID])
    })

    it("responde 404 quando o post não está publicado", async () => {
      services.unlikePost.mock.mockImplementation(async () => null)

      const res = await request(buildServer()).delete("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.unlikePost.mock.mockImplementation(failing)

      const res = await request(buildServer()).delete("/posts/post-1/likes").set(visitor)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to remove like" })
    })
  })

  describe("GET /posts/popular", () => {
    it("usa days=7 e limit=10 por padrão, sem cair em /posts/:id", async () => {
      const res = await request(buildServer()).get("/posts/popular")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: [popular] })
      assert.deepEqual(services.listPopularPosts.mock.calls[0].arguments, [{ days: 7, limit: 10 }])
    })

    it("converte days e limit da query string", async () => {
      await request(buildServer()).get("/posts/popular?days=30&limit=5").expect(200)

      assert.deepEqual(services.listPopularPosts.mock.calls[0].arguments, [{ days: 30, limit: 5 }])
    })

    for (const [query, field] of INVALID_POPULAR_QUERIES) {
      it(`responde 400 para ${query}`, async () => {
        const res = await request(buildServer()).get(`/posts/popular?${query}`)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid query parameters")
        assert.equal(res.body.errors[0].field, field)
        assert.equal(services.listPopularPosts.mock.callCount(), 0)
      })
    }

    it("responde 500 quando o service falha", async () => {
      services.listPopularPosts.mock.mockImplementation(failing)

      const res = await request(buildServer()).get("/posts/popular")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to list popular posts" })
    })
  })

  describe("/posts/:id/likes: rate limit", () => {
    it("POST e DELETE dividem a cota e respondem 429 sem chamar o service", async () => {
      const server = buildLimitedServer()

      await request(server).post("/posts/post-1/likes").set(visitor).expect(201)
      await request(server).delete("/posts/post-1/likes").set(visitor).expect(200)

      for (const method of ["post", "delete"] as const) {
        const res = await request(server)[method]("/posts/post-1/likes").set(visitor)

        assert.equal(res.status, 429)
        assert.deepEqual(res.body, { message: "Too Many Requests" })
      }

      assert.equal(services.likePost.mock.callCount(), 1)
      assert.equal(services.unlikePost.mock.callCount(), 1)
    })

    it("não limita GET /posts/popular", async () => {
      const server = buildLimitedServer()

      for (let i = 0; i < 3; i++) await request(server).get("/posts/popular").expect(200)
    })
  })
})
