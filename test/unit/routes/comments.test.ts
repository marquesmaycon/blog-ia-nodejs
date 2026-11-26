// Testa as rotas de comentários isoladamente: a camada de services é substituída por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import type { Comment, CommentStatus } from "../../../src/domain/comments.ts"
import type { DraftReplyResult } from "../../../src/services/comment-replies.ts"
import type { CommentInput } from "../../../src/services/comments.ts"

const comment: Comment = {
  id: "c-1",
  post_id: "post-1",
  author_name: "Ana",
  content: "Muito bom!",
  status: "pending",
  moderation_reason: null,
  moderation_categories: [],
  parent_id: null,
  author_type: "reader",
  created_at: "2026-01-02T00:00:00.000Z"
}

const services = {
  listPostComments: mock.fn(async (_postId: string): Promise<Comment[] | null> => [comment]),
  createComment: mock.fn(
    async (_postId: string, _input: CommentInput): Promise<Comment | null> => comment
  ),
  listCommentsByStatus: mock.fn(async (_status: CommentStatus): Promise<Comment[]> => [comment]),
  approveComment: mock.fn(async (_id: string): Promise<Comment | null> => comment),
  deleteComment: mock.fn(async (_id: string): Promise<boolean> => true)
}

const reply: Comment = {
  ...comment,
  id: "r-1",
  author_name: "Autor do blog (IA)",
  content: "Resposta",
  parent_id: "c-1",
  author_type: "ai"
}

const replies = {
  draftCommentReply: mock.fn(async (_id: string): Promise<DraftReplyResult> => ({
    ok: true,
    reply
  }))
}

mock.module(import.meta.resolve("../../../src/services/comments.ts"), { exports: services })
mock.module(import.meta.resolve("../../../src/services/comment-replies.ts"), { exports: replies })

const { createApp } = await import("../../../src/http/app.ts")
const { registerCommentRoutes } = await import("../../../src/routes/comments.ts")

const auth = { Authorization: "Bearer secret" }

function buildServer() {
  const app = createApp()
  registerCommentRoutes(app)
  return app.server
}

function buildLimitedServer() {
  const app = createApp()
  registerCommentRoutes(app, { rateLimit: { max: 1, windowMs: 60_000 } })
  return app.server
}

const failing = async () => {
  throw new Error("db down")
}

describe("rotas de comentários", () => {
  const originalApiKey = process.env.API_KEY

  beforeEach(() => {
    process.env.API_KEY = "secret"
    for (const fn of [...Object.values(services), replies.draftCommentReply]) fn.mock.resetCalls()
    mock.method(console, "error", () => {})
  })

  afterEach(() => {
    mock.restoreAll()
    if (originalApiKey === undefined) delete process.env.API_KEY
    else process.env.API_KEY = originalApiKey
  })

  describe("GET /posts/:id/comments", () => {
    it("lista os comentários aprovados do post", async () => {
      const res = await request(buildServer()).get("/posts/post-1/comments")

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: [comment] })
      assert.deepEqual(services.listPostComments.mock.calls[0].arguments, ["post-1"])
    })

    it("responde 404 quando o post não existe ou não está aprovado", async () => {
      services.listPostComments.mock.mockImplementationOnce(async () => null)

      const res = await request(buildServer()).get("/posts/post-1/comments")

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.listPostComments.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).get("/posts/post-1/comments")

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to list comments" })
    })
  })

  describe("POST /posts/:id/comments", () => {
    it("cria o comentário (com trim) e responde 201", async () => {
      const res = await request(buildServer())
        .post("/posts/post-1/comments")
        .send({ author_name: "  Ana  ", content: "  Muito bom!  " })

      assert.equal(res.status, 201)
      assert.deepEqual(res.body, { message: "Comment awaiting moderation", data: comment })
      assert.deepEqual(services.createComment.mock.calls[0].arguments, [
        "post-1",
        { author_name: "Ana", content: "Muito bom!" }
      ])
    })

    for (const [status, message] of [
      ["approved", "Comment published"],
      ["rejected", "Comment rejected"],
      ["pending", "Comment awaiting moderation"]
    ] as const) {
      it(`responde 201 com "${message}" quando o moderador deixa ${status}`, async () => {
        const moderated = { ...comment, status }
        services.createComment.mock.mockImplementationOnce(async () => moderated)

        const res = await request(buildServer())
          .post("/posts/post-1/comments")
          .send({ author_name: "Ana", content: "Oi" })

        assert.equal(res.status, 201)
        assert.deepEqual(res.body, { message, data: moderated })
      })
    }

    for (const [name, body] of [
      ["sem body", undefined],
      ["sem author_name", { content: "Oi" }],
      ["sem content", { author_name: "Ana" }],
      ["com content vazio", { author_name: "Ana", content: "   " }],
      ["com author_name longo demais", { author_name: "a".repeat(81), content: "Oi" }],
      ["com content longo demais", { author_name: "Ana", content: "a".repeat(2001) }],
      ["com tipos errados", { author_name: 1, content: true }]
    ] as const) {
      it(`responde 400 ${name}`, async () => {
        const res = await request(buildServer()).post("/posts/post-1/comments").send(body)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid request body")
        assert.equal(services.createComment.mock.callCount(), 0)
      })
    }

    it("lista um erro por campo inválido", async () => {
      const res = await request(buildServer())
        .post("/posts/post-1/comments")
        .send({ author_name: "", content: "a".repeat(2001) })

      assert.deepEqual(res.body, {
        message: "Invalid request body",
        errors: [
          { field: "author_name", message: "Too small: expected string to have >=1 characters" },
          { field: "content", message: "Too big: expected string to have <=2000 characters" }
        ]
      })
    })

    it("aceita os tamanhos máximos", async () => {
      const res = await request(buildServer())
        .post("/posts/post-1/comments")
        .send({ author_name: "a".repeat(80), content: "a".repeat(2000) })

      assert.equal(res.status, 201)
    })

    it("responde 404 quando o post não existe ou não está aprovado", async () => {
      services.createComment.mock.mockImplementationOnce(async () => null)

      const res = await request(buildServer())
        .post("/posts/post-1/comments")
        .send({ author_name: "Ana", content: "Oi" })

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Post not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.createComment.mock.mockImplementationOnce(failing)

      const res = await request(buildServer())
        .post("/posts/post-1/comments")
        .send({ author_name: "Ana", content: "Oi" })

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to create comment" })
    })
  })

  describe("rotas administrativas exigem API key", () => {
    const adminRoutes = [
      {
        name: "GET /comments",
        send: () => request(buildServer()).get("/comments"),
        service: services.listCommentsByStatus
      },
      {
        name: "PATCH /comments/:id/approve",
        send: () => request(buildServer()).patch("/comments/c-1/approve"),
        service: services.approveComment
      },
      {
        name: "POST /comments/:id/reply",
        send: () => request(buildServer()).post("/comments/c-1/reply"),
        service: replies.draftCommentReply
      },
      {
        name: "DELETE /comments/:id",
        send: () => request(buildServer()).delete("/comments/c-1"),
        service: services.deleteComment
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
  })

  describe("GET /comments", () => {
    it("lista os pendentes por padrão", async () => {
      const res = await request(buildServer()).get("/comments").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: [comment] })
      assert.deepEqual(services.listCommentsByStatus.mock.calls[0].arguments, ["pending"])
    })

    for (const status of ["pending", "approved", "rejected"]) {
      it(`filtra por status=${status}`, async () => {
        await request(buildServer()).get(`/comments?status=${status}`).set(auth).expect(200)

        assert.deepEqual(services.listCommentsByStatus.mock.calls[0].arguments, [status])
      })
    }

    it("responde 400 para status inválido", async () => {
      const res = await request(buildServer()).get("/comments?status=spam").set(auth)

      assert.equal(res.status, 400)
      assert.equal(res.body.message, "Invalid query parameters")
      assert.equal(res.body.errors[0].field, "status")
      assert.equal(services.listCommentsByStatus.mock.callCount(), 0)
    })

    it("responde 500 quando o service falha", async () => {
      services.listCommentsByStatus.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).get("/comments").set(auth)

      assert.equal(res.status, 500)
    })
  })

  describe("PATCH /comments/:id/approve", () => {
    it("aprova o comentário", async () => {
      const approved = { ...comment, status: "approved" as const }
      services.approveComment.mock.mockImplementationOnce(async () => approved)

      const res = await request(buildServer()).patch("/comments/c-1/approve").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Comment approved", data: approved })
      assert.deepEqual(services.approveComment.mock.calls[0].arguments, ["c-1"])
    })

    it("responde 404 quando o comentário não existe", async () => {
      services.approveComment.mock.mockImplementationOnce(async () => null)

      const res = await request(buildServer()).patch("/comments/missing/approve").set(auth)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Comment not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.approveComment.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).patch("/comments/c-1/approve").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to approve comment" })
    })
  })

  describe("POST /comments/:id/reply", () => {
    it("cria o rascunho de resposta e responde 201", async () => {
      const res = await request(buildServer()).post("/comments/c-1/reply").set(auth)

      assert.equal(res.status, 201)
      assert.deepEqual(res.body, { message: "Reply draft created", data: reply })
      assert.deepEqual(replies.draftCommentReply.mock.calls[0].arguments, ["c-1"])
    })

    for (const [error, status, message, reason] of [
      ["not_found", 404, "Comment not found", undefined],
      ["not_eligible", 409, "Comment cannot be replied", undefined],
      ["already_replied", 409, "Reply already exists", undefined],
      ["not_a_question", 422, "Comment is not an answerable question", "É um elogio"],
      ["not_answerable", 422, "Comment is not an answerable question", "O post não cobre"],
      ["generation_failed", 502, "Failed to generate reply", undefined]
    ] as const) {
      it(`responde ${status} para ${error}`, async () => {
        replies.draftCommentReply.mock.mockImplementationOnce(async () => ({
          ok: false,
          error,
          ...(reason ? { reason } : {})
        }))

        const res = await request(buildServer()).post("/comments/c-1/reply").set(auth)

        assert.equal(res.status, status)
        assert.deepEqual(res.body, reason ? { message, reason } : { message })
      })
    }

    it("responde 500 quando o service falha", async () => {
      replies.draftCommentReply.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).post("/comments/c-1/reply").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to create reply" })
    })
  })

  describe("DELETE /comments/:id", () => {
    it("apaga o comentário", async () => {
      const res = await request(buildServer()).delete("/comments/c-1").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { message: "Comment deleted" })
      assert.deepEqual(services.deleteComment.mock.calls[0].arguments, ["c-1"])
    })

    it("responde 404 quando o comentário não existe", async () => {
      services.deleteComment.mock.mockImplementationOnce(async () => false)

      const res = await request(buildServer()).delete("/comments/missing").set(auth)

      assert.equal(res.status, 404)
      assert.deepEqual(res.body, { message: "Comment not found" })
    })

    it("responde 500 quando o service falha", async () => {
      services.deleteComment.mock.mockImplementationOnce(failing)

      const res = await request(buildServer()).delete("/comments/c-1").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to delete comment" })
    })
  })

  describe("POST /posts/:id/comments: rate limit", () => {
    it("responde 429 ao estourar a cota, sem chamar o service", async () => {
      const server = buildLimitedServer()
      const body = { author_name: "Ana", content: "Muito bom!" }

      await request(server).post("/posts/post-1/comments").send(body).expect(201)
      const res = await request(server).post("/posts/post-1/comments").send(body)

      assert.equal(res.status, 429)
      assert.deepEqual(res.body, { message: "Too Many Requests" })
      assert.ok(res.headers["retry-after"])
      assert.equal(services.createComment.mock.callCount(), 1)
    })

    it("conta requisições inválidas na cota", async () => {
      const server = buildLimitedServer()

      await request(server).post("/posts/post-1/comments").send({}).expect(400)
      await request(server)
        .post("/posts/post-1/comments")
        .send({ author_name: "Ana", content: "Muito bom!" })
        .expect(429)

      assert.equal(services.createComment.mock.callCount(), 0)
    })

    it("não limita as rotas de leitura", async () => {
      const server = buildLimitedServer()

      for (let i = 0; i < 3; i++) await request(server).get("/posts/post-1/comments").expect(200)
    })
  })
})
