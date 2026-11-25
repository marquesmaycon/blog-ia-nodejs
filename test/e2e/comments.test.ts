// Fluxo completo de comentários pela API HTTP (supertest), com Postgres real (banco blog_test).
// O moderador IA é mockado em mastra.getAgent; por padrão manda tudo para revisão humana.
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { mastra } from "../../src/mastra/index.ts"
import type { Comment } from "../../src/repositories/comments.ts"
import { registerCommentRoutes } from "../../src/routes/comments.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, seedComment, seedPost, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerPostRoutes(app)
// Cota folgada: o app é compartilhado entre os testes, e o limite tem e2e próprio (rate-limit.test.ts)
registerCommentRoutes(app, { rateLimit: { max: 1000, windowMs: 60_000 } })
const api = () => request(app.server)

const ids = (comments: Comment[]) => comments.map((comment) => comment.id)

// Só o LLM é substituído (ver test/e2e/posts.test.ts): o moderador responde o veredito dado
function mockModerator(generate: () => Promise<unknown>) {
  return mock.method(mastra, "getAgent", (() => ({ generate })) as never)
}

const moderatorVerdict = (verdict: string, reason = "Motivo", categories: string[] = []) =>
  mockModerator(async () => ({ object: { verdict, reason, categories } }))

describe("E2E comentários", () => {
  beforeEach(async () => {
    await truncatePosts()
    moderatorVerdict("review", "Precisa de revisão humana")
  })
  afterEach(() => mock.restoreAll())
  after(() => pool.end())

  it("ciclo de vida: comentário em revisão → aprovado → apagado", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

    // 1. Leitor comenta e o moderador pede revisão: fica pendente e não aparece publicamente
    const created = await api()
      .post(`/posts/${post.id}/comments`)
      .send({ author_name: "Ana", content: "Muito bom!" })
      .expect(201)

    const comment: Comment = created.body.data
    assert.equal(created.body.message, "Comment awaiting moderation")
    assert.equal(comment.status, "pending")
    assert.equal(comment.post_id, post.id)
    assert.equal(comment.moderation_reason, "Precisa de revisão humana")

    assert.deepEqual((await api().get(`/posts/${post.id}/comments`).expect(200)).body, {
      data: []
    })

    // 2. Aparece na fila de moderação
    const queue = await api().get("/comments").set(auth).expect(200)
    assert.deepEqual(ids(queue.body.data), [comment.id])

    // 3. Admin aprova: sai da fila e passa a ser público
    const approved = await api().patch(`/comments/${comment.id}/approve`).set(auth).expect(200)
    assert.equal(approved.body.data.status, "approved")

    assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    const publicList = await api().get(`/posts/${post.id}/comments`).expect(200)
    assert.deepEqual(ids(publicList.body.data), [comment.id])

    // 4. Admin apaga: some de vez
    await api().delete(`/comments/${comment.id}`).set(auth).expect(200, {
      message: "Comment deleted"
    })
    assert.deepEqual((await api().get(`/posts/${post.id}/comments`).expect(200)).body, {
      data: []
    })
    await api().delete(`/comments/${comment.id}`).set(auth).expect(404)
  })

  describe("moderador IA", () => {
    const body = { author_name: "Ana", content: "Muito bom!" }

    it("approve publica o comentário na hora", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      mock.restoreAll()
      moderatorVerdict("approve", "Comentário legítimo")

      const res = await api().post(`/posts/${post.id}/comments`).send(body).expect(201)

      assert.equal(res.body.message, "Comment published")
      assert.equal(res.body.data.status, "approved")
      assert.equal(res.body.data.moderation_reason, null)

      const publicList = await api().get(`/posts/${post.id}/comments`).expect(200)
      assert.deepEqual(ids(publicList.body.data), [res.body.data.id])
      assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    })

    it("reject reprova com motivo e categorias, fora da listagem pública", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      mock.restoreAll()
      moderatorVerdict("reject", "Propaganda de produto", ["spam", "self-promotion"])

      const res = await api().post(`/posts/${post.id}/comments`).send(body).expect(201)

      assert.equal(res.body.message, "Comment rejected")

      const rejected = await api().get("/comments?status=rejected").set(auth).expect(200)
      assert.deepEqual(ids(rejected.body.data), [res.body.data.id])
      assert.equal(rejected.body.data[0].moderation_reason, "Propaganda de produto")
      assert.deepEqual(rejected.body.data[0].moderation_categories, ["spam", "self-promotion"])
      assert.deepEqual((await api().get(`/posts/${post.id}/comments`).expect(200)).body, {
        data: []
      })
    })

    it("falha do LLM deixa o comentário pendente, sem motivo", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      mock.restoreAll()
      mock.method(console, "error", () => {})
      mockModerator(async () => {
        throw new Error("provider down")
      })

      const res = await api().post(`/posts/${post.id}/comments`).send(body).expect(201)

      assert.equal(res.body.message, "Comment awaiting moderation")
      assert.equal(res.body.data.status, "pending")
      assert.equal(res.body.data.moderation_reason, null)
      assert.deepEqual(res.body.data.moderation_categories, [])

      const queue = await api().get("/comments").set(auth).expect(200)
      assert.deepEqual(ids(queue.body.data), [res.body.data.id])
    })
  })

  it("filtra a listagem administrativa por status", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
    const rejected = await seedComment({
      post_id: post.id,
      status: "rejected",
      moderation_reason: "spam"
    })
    await seedComment({ post_id: post.id })

    const res = await api().get("/comments?status=rejected").set(auth).expect(200)

    assert.deepEqual(ids(res.body.data), [rejected.id])
    assert.equal(res.body.data[0].moderation_reason, "spam")
  })

  describe("só posts aprovados aceitam e exibem comentários", () => {
    const body = { author_name: "Ana", content: "Oi" }
    const notFound = { message: "Post not found" }

    it("responde 404 para post inexistente", async () => {
      await api().get("/posts/inexistente/comments").expect(404, notFound)
      await api().post("/posts/inexistente/comments").send(body).expect(404, notFound)
    })

    it("responde 404 para rascunho e reprovado, sem persistir nada", async () => {
      const draft = await seedPost()
      const rejected = await seedPost({ rejected_at: "2026-01-01T00:00:00.000Z" })

      for (const post of [draft, rejected]) {
        await api().get(`/posts/${post.id}/comments`).expect(404, notFound)
        await api().post(`/posts/${post.id}/comments`).send(body).expect(404, notFound)
      }

      assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    })
  })

  describe("autorização das rotas administrativas", () => {
    it("responde 403 sem API key e não altera o comentário", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      const comment = await seedComment({ post_id: post.id })
      const forbidden = { message: "Forbidden" }

      await api().get("/comments").expect(403, forbidden)
      await api().patch(`/comments/${comment.id}/approve`).expect(403, forbidden)
      await api().delete(`/comments/${comment.id}`).expect(403, forbidden)

      const queue = await api().get("/comments").set(auth).expect(200)
      assert.deepEqual(queue.body.data, [comment])
    })
  })

  it("responde 400 para comentário inválido", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

    await api()
      .post(`/posts/${post.id}/comments`)
      .send({ author_name: "Ana", content: "" })
      .expect(400)
  })
})
