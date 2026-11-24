// Fluxo completo de curtidas pela API HTTP (supertest), com Postgres real (banco blog_test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import type { PopularPost } from "../../src/repositories/posts.ts"
import { registerLikeRoutes } from "../../src/routes/likes.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, seedComment, seedLike, seedPost, truncatePosts } from "../helpers/db.ts"

const app = createApp()
registerPostRoutes(app)
registerLikeRoutes(app)
const api = () => request(app.server)

const ANA = { "X-Visitor-Id": "visitor-ana" }
const BIA = { "X-Visitor-Id": "visitor-bia" }
const APPROVED = { approved_at: "2026-01-01T00:00:00.000Z" }

const likesOf = async (postId: string): Promise<number> =>
  (await api().get(`/posts/${postId}`).expect(200)).body.data.likes_count

describe("E2E curtidas", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  it("ciclo de vida: curtir, repetir, outro visitante, descurtir", async () => {
    const post = await seedPost(APPROVED)

    // 1. Primeira curtida: 201 e o contador aparece no post
    const liked = await api().post(`/posts/${post.id}/likes`).set(ANA).expect(201)
    assert.deepEqual(liked.body, {
      message: "Post liked",
      data: { post_id: post.id, liked: true, likes_count: 1 }
    })
    assert.equal(await likesOf(post.id), 1)

    // 2. Repetir é idempotente: 200 e o contador não muda
    const again = await api().post(`/posts/${post.id}/likes`).set(ANA).expect(200)
    assert.equal(again.body.message, "Post already liked")
    assert.equal(again.body.data.likes_count, 1)

    // 3. Outro visitante soma
    await api().post(`/posts/${post.id}/likes`).set(BIA).expect(201)
    assert.equal(await likesOf(post.id), 2)

    // 4. Descurtir remove só a curtida do visitante, e repetir também é 200
    const removed = await api().delete(`/posts/${post.id}/likes`).set(ANA).expect(200)
    assert.deepEqual(removed.body, {
      message: "Like removed",
      data: { post_id: post.id, liked: false, likes_count: 1 }
    })
    await api().delete(`/posts/${post.id}/likes`).set(ANA).expect(200)
    assert.equal(await likesOf(post.id), 1)
  })

  it("GET /posts traz likes_count e comments_count (só aprovados)", async () => {
    const post = await seedPost(APPROVED)
    await seedLike({ post_id: post.id })
    await seedComment({ post_id: post.id, status: "approved" })
    await seedComment({ post_id: post.id, status: "pending" })

    const res = await api().get("/posts").expect(200)

    assert.equal(res.body.data[0].likes_count, 1)
    assert.equal(res.body.data[0].comments_count, 1)
  })

  it("GET /posts/popular ordena pelas curtidas recentes", async () => {
    const quiet = await seedPost(APPROVED)
    const hot = await seedPost(APPROVED)
    await seedPost(APPROVED)

    await api().post(`/posts/${quiet.id}/likes`).set(ANA).expect(201)
    await api().post(`/posts/${hot.id}/likes`).set(ANA).expect(201)
    await api().post(`/posts/${hot.id}/likes`).set(BIA).expect(201)

    const res = await api().get("/posts/popular?days=1").expect(200)
    const posts: PopularPost[] = res.body.data

    assert.deepEqual(
      posts.map((p) => [p.id, p.recent_likes]),
      [
        [hot.id, 2],
        [quiet.id, 1]
      ]
    )

    await api().get("/posts/popular?limit=0").expect(400)
  })

  describe("só posts aprovados aceitam curtidas", () => {
    const notFound = { message: "Post not found" }

    it("responde 404 para post inexistente, rascunho e reprovado, sem gravar nada", async () => {
      const draft = await seedPost()
      const rejected = await seedPost({ rejected_at: "2026-01-01T00:00:00.000Z" })

      for (const id of ["inexistente", draft.id, rejected.id]) {
        await api().post(`/posts/${id}/likes`).set(ANA).expect(404, notFound)
        await api().delete(`/posts/${id}/likes`).set(ANA).expect(404, notFound)
      }

      const { rowCount } = await pool.query("SELECT 1 FROM post_likes")
      assert.equal(rowCount, 0)
    })
  })

  it("responde 400 sem X-Visitor-Id", async () => {
    const post = await seedPost(APPROVED)

    const res = await api().post(`/posts/${post.id}/likes`).expect(400)

    assert.equal(res.body.errors[0].field, "x-visitor-id")
    assert.equal(await likesOf(post.id), 0)
  })
})
