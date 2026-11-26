// Testa as rotas isoladamente: a camada de services é substituída por mocks,
// então nenhum acesso a banco ou LLM acontece. Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import type { PostReview } from "../../../src/repositories/post-reviews.ts"
import type { Post } from "../../../src/repositories/posts.ts"
import type { PostReviewSummary } from "../../../src/services/post-reviews.ts"
import type {
  ListPostsOptions,
  PaginatedPosts,
  PostContent,
  PostDraft,
  UpdatePostDraftResult
} from "../../../src/services/posts.ts"

const emptyPage: PaginatedPosts = { data: [], meta: { page: 1, limit: 10, total: 0 } }

const services = {
  listPosts: mock.fn(async (_options?: ListPostsOptions): Promise<PaginatedPosts> => emptyPage),
  getPost: mock.fn(async (_id: string): Promise<Post | null> => null),
  getPublishedPostBySlug: mock.fn(async (_slug: string): Promise<Post | null> => null),
  updatePostDraft: mock.fn(
    async (_id: string, _data: PostContent): Promise<UpdatePostDraftResult> => ({
      status: "not_found"
    })
  ),
  approvePost: mock.fn(async (_id: string): Promise<Post | null> => null),
  rejectPost: mock.fn(async (_id: string): Promise<Post | null> => null),
  createPostDraft: mock.fn(async (_idea: string): Promise<PostDraft> => ({ ...post, review: null }))
}

const reviewServices = {
  getPostReviews: mock.fn(async (_id: string): Promise<PostReviewSummary | null> => null)
}

// As constantes de paginação também saem do módulo mockado, então entram nos exports
mock.module(import.meta.resolve("../../../src/services/posts.ts"), {
  exports: { ...services, DEFAULT_PAGE_LIMIT: 10, MAX_PAGE_LIMIT: 50 }
})

mock.module(import.meta.resolve("../../../src/services/post-reviews.ts"), {
  exports: reviewServices
})

const { createApp } = await import("../../../src/http/app.ts")
const { registerPostRoutes } = await import("../../../src/routes/posts.ts")

const post: Post = {
  id: "abc",
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
  tags: []
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
    for (const fn of [...Object.values(services), ...Object.values(reviewServices)]) {
      fn.mock.resetCalls()
    }
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
      const page = { data: [post], meta: { page: 1, limit: 10, total: 1 } }
      services.listPosts.mock.mockImplementationOnce(async () => page)

      const res = await request(buildServer()).get("/posts")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, page)
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [
        { includeAll: false, tag: undefined, page: 1, limit: 10, q: undefined }
      ])
    })

    it("lista todos com include=all e API key válida", async () => {
      const res = await request(buildServer())
        .get("/posts?include=all")
        .set("Authorization", "Bearer secret")

      assert.equal(res.status, 200)
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [
        { includeAll: true, tag: undefined, page: 1, limit: 10, q: undefined }
      ])
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

    it("repassa o filtro por tag ao service", async () => {
      const res = await request(buildServer()).get("/posts?tag=node-js")

      assert.equal(res.status, 200)
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [
        { includeAll: false, tag: "node-js", page: 1, limit: 10, q: undefined }
      ])
    })

    it("combina o filtro por tag com include=all", async () => {
      const res = await request(buildServer()).get("/posts?include=all&tag=ia").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [
        { includeAll: true, tag: "ia", page: 1, limit: 10, q: undefined }
      ])
    })

    for (const tag of ["Node.js", "node--js", "-ia", "com espaço", "x".repeat(51)]) {
      it(`responde 400 para tag que não é slug: ${JSON.stringify(tag.slice(0, 12))}`, async () => {
        const res = await request(buildServer()).get(`/posts?tag=${encodeURIComponent(tag)}`)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid query parameters")
        assert.equal(res.body.errors[0].field, "tag")
        assert.equal(services.listPosts.mock.callCount(), 0)
      })
    }

    it("repassa page, limit e q ao service", async () => {
      const res = await request(buildServer()).get("/posts?page=3&limit=5&q=node%20streams&tag=ia")

      assert.equal(res.status, 200)
      assert.deepEqual(services.listPosts.mock.calls[0].arguments, [
        { includeAll: false, tag: "ia", page: 3, limit: 5, q: "node streams" }
      ])
    })

    it("trata q vazio ou só com espaços como busca ausente", async () => {
      await request(buildServer()).get("/posts?q=%20%20%20").expect(200)
      await request(buildServer()).get("/posts?q=").expect(200)

      for (const call of services.listPosts.mock.calls) {
        assert.equal(call.arguments[0]?.q, undefined)
      }
    })

    const invalidQueries = [
      { query: "page=0", field: "page" },
      { query: "page=-1", field: "page" },
      { query: "page=1.5", field: "page" },
      { query: "limit=0", field: "limit" },
      { query: "limit=51", field: "limit" },
      { query: "limit=abc", field: "limit" },
      { query: `q=${"x".repeat(201)}`, field: "q" }
    ]

    for (const { query, field } of invalidQueries) {
      it(`responde 400 para ${query.slice(0, 20)}`, async () => {
        const res = await request(buildServer()).get(`/posts?${query}`)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid query parameters")
        assert.equal(res.body.errors[0].field, field)
        assert.equal(services.listPosts.mock.callCount(), 0)
      })
    }

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
      },
      {
        name: "GET /posts/:id/review",
        send: () => request(buildServer()).get("/posts/abc/review"),
        service: reviewServices.getPostReviews
      },
      {
        name: "PUT /posts/:id",
        send: () => request(buildServer()).put("/posts/abc").send({ title: "T", content: "C" }),
        service: services.updatePostDraft
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

  describe("GET /posts/:id/review", () => {
    const postReview: PostReview = {
      id: "r1",
      post_id: "abc",
      attempt: 1,
      score: 8,
      issues: [],
      suggestions: [],
      created_at: "2026-01-01T00:00:00.000Z"
    }

    it("retorna a última revisão e o histórico", async () => {
      const summary = { latest: postReview, history: [postReview] }
      reviewServices.getPostReviews.mock.mockImplementationOnce(async () => summary)

      const res = await request(buildServer()).get("/posts/abc/review").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: summary })
      assert.deepEqual(reviewServices.getPostReviews.mock.calls[0].arguments, ["abc"])
    })

    it("responde 404 quando o post não existe", async () => {
      const res = await request(buildServer()).get("/posts/missing/review").set(auth)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      reviewServices.getPostReviews.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).get("/posts/abc/review").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to get post review" })
    })
  })

  describe("GET /posts/slug/:slug", () => {
    it("retorna o post publicado com o slug", async () => {
      services.getPublishedPostBySlug.mock.mockImplementationOnce(async () => post)

      const res = await request(buildServer()).get("/posts/slug/titulo")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: post })
      assert.deepEqual(services.getPublishedPostBySlug.mock.calls[0].arguments, ["titulo"])
      // O segmento estático "slug" vence o :id
      assert.equal(services.getPost.mock.callCount(), 0)
    })

    it("responde 404 quando não há post publicado com o slug", async () => {
      const res = await request(buildServer()).get("/posts/slug/rascunho")

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    for (const slug of ["Maiuscula", "com_underline", "-borda", "a--b", "x".repeat(101)]) {
      it(`responde 400 para o slug ${JSON.stringify(slug.slice(0, 20))}`, async () => {
        const res = await request(buildServer()).get(`/posts/slug/${slug}`)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid slug")
        assert.equal(services.getPublishedPostBySlug.mock.callCount(), 0)
      })
    }

    it("responde 500 quando o service falha", async () => {
      services.getPublishedPostBySlug.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).get("/posts/slug/titulo")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to get post" })
    })
  })

  describe("PUT /posts/:id", () => {
    const body = { title: "  Novo título  ", content: "  Novo conteúdo  " }

    it("edita o rascunho com os campos já com trim", async () => {
      const updated = { ...post, title: "Novo título", content: "Novo conteúdo" }
      services.updatePostDraft.mock.mockImplementationOnce(async () => ({
        status: "updated",
        post: updated
      }))

      const res = await request(buildServer()).put("/posts/abc").set(auth).send(body)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Post updated", data: updated })
      assert.deepEqual(services.updatePostDraft.mock.calls[0].arguments, [
        "abc",
        { title: "Novo título", content: "Novo conteúdo" }
      ])
    })

    it("responde 404 quando o post não existe", async () => {
      const res = await request(buildServer()).put("/posts/missing").set(auth).send(body)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 409 quando o post já foi aprovado", async () => {
      services.updatePostDraft.mock.mockImplementationOnce(async () => ({ status: "approved" }))

      const res = await request(buildServer()).put("/posts/abc").set(auth).send(body)

      assert.equal(res.status, 409)
      assert.deepEqual(res.body, { message: "Approved posts cannot be edited" })
    })

    it("repassa summary e meta_description com trim, e texto vazio vira null", async () => {
      services.updatePostDraft.mock.mockImplementationOnce(async () => ({
        status: "updated",
        post
      }))

      const res = await request(buildServer())
        .put("/posts/abc")
        .set(auth)
        .send({ ...body, summary: "  Resumo  ", meta_description: "   " })

      assert.equal(res.status, 200)
      assert.deepEqual(services.updatePostDraft.mock.calls[0].arguments, [
        "abc",
        {
          title: "Novo título",
          content: "Novo conteúdo",
          summary: "Resumo",
          meta_description: null
        }
      ])
    })

    it("aceita null explícito em summary e meta_description", async () => {
      services.updatePostDraft.mock.mockImplementationOnce(async () => ({
        status: "updated",
        post
      }))

      await request(buildServer())
        .put("/posts/abc")
        .set(auth)
        .send({ ...body, summary: null, meta_description: null })
        .expect(200)

      const [, data] = services.updatePostDraft.mock.calls[0].arguments
      assert.equal(data.summary, null)
      assert.equal(data.meta_description, null)
    })

    for (const [name, invalid, field] of [
      [
        "com summary longo demais",
        { title: "T", content: "C", summary: "x".repeat(301) },
        "summary"
      ],
      [
        "com meta_description longa demais",
        { title: "T", content: "C", meta_description: "x".repeat(161) },
        "meta_description"
      ],
      ["com summary que não é string", { title: "T", content: "C", summary: 1 }, "summary"],
      ["sem title", { content: "C" }, "title"],
      ["sem content", { title: "T" }, "content"],
      ["com title vazio", { title: "   ", content: "C" }, "title"],
      ["com title longo demais", { title: "x".repeat(201), content: "C" }, "title"],
      ["com content que não é string", { title: "T", content: 1 }, "content"]
    ] as const) {
      it(`responde 400 ${name}`, async () => {
        const res = await request(buildServer()).put("/posts/abc").set(auth).send(invalid)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid request body")
        assert.equal(res.body.errors[0].field, field)
        assert.equal(services.updatePostDraft.mock.callCount(), 0)
      })
    }

    it("checa a API key antes de validar o body", async () => {
      const res = await request(buildServer()).put("/posts/abc").send({})

      assert.equal(res.status, 403)
    })

    it("responde 500 quando o service falha", async () => {
      services.updatePostDraft.mock.mockImplementationOnce(async () => {
        throw new Error("db down")
      })

      const res = await request(buildServer()).put("/posts/abc").set(auth).send(body)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to update post" })
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
      assert.deepEqual(res.body, { message: "Post draft created", data: { ...post, review: null } })
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
        assert.equal(res.body.message, "Invalid request body")
        assert.ok(res.body.errors.length > 0)
        assert.equal(services.createPostDraft.mock.callCount(), 0)
      })
    }

    it("aponta o campo idea no erro de validação", async () => {
      const res = await request(buildServer()).post("/posts/draft").set(auth).send({ idea: "" })

      assert.deepEqual(res.body, {
        message: "Invalid request body",
        errors: [{ field: "idea", message: "Too small: expected string to have >=1 characters" }]
      })
    })

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
