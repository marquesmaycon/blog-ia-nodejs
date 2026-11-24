// Fluxo completo de comentários pela API HTTP (supertest), com Postgres real (banco blog_test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import type { Comment } from "../../src/repositories/comments.ts"
import { registerCommentRoutes } from "../../src/routes/comments.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, seedComment, seedPost, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerPostRoutes(app)
registerCommentRoutes(app)
const api = () => request(app.server)

const ids = (comments: Comment[]) => comments.map((comment) => comment.id)

describe("E2E comentários", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  it("ciclo de vida: comentário pendente → aprovado → apagado", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

    // 1. Leitor comenta: nasce pendente e não aparece publicamente
    const created = await api()
      .post(`/posts/${post.id}/comments`)
      .send({ author_name: "Ana", content: "Muito bom!" })
      .expect(201)

    const comment: Comment = created.body.data
    assert.equal(created.body.message, "Comment awaiting moderation")
    assert.equal(comment.status, "pending")
    assert.equal(comment.post_id, post.id)

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
