// Rate limiting pela API HTTP (supertest), com Postgres real (banco blog_test).
// O moderador IA é mockado em mastra.getAgent para não chamar o provedor real.
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { mastra } from "../../src/mastra/index.ts"
import { registerCommentRoutes } from "../../src/routes/comments.ts"
import { registerLikeRoutes } from "../../src/routes/likes.ts"
import { pool, seedPost, truncatePosts } from "../helpers/db.ts"

const LIMIT = { max: 2, windowMs: 60_000 }
const APPROVED = { approved_at: "2026-01-01T00:00:00.000Z" }
const visitor = (id: string) => ({ "X-Visitor-Id": `visitor-${id}` })

const reviewVerdict = async () => ({
  object: { verdict: "review", reason: "Ok", categories: [] }
})

// Cada teste monta o próprio app para começar com a cota zerada
function buildApi() {
  const app = createApp()
  registerCommentRoutes(app, { rateLimit: LIMIT })
  registerLikeRoutes(app, { rateLimit: LIMIT })
  return () => request(app.server)
}

describe("E2E rate limit", () => {
  beforeEach(async () => {
    await truncatePosts()
    mock.method(mastra, "getAgent", (() => ({ generate: reviewVerdict })) as never)
  })
  afterEach(() => mock.restoreAll())
  after(() => pool.end())

  it("comentários além da cota respondem 429 e não são gravados", async () => {
    const api = buildApi()
    const post = await seedPost(APPROVED)
    const body = { author_name: "Ana", content: "Muito bom!" }

    await api().post(`/posts/${post.id}/comments`).send(body).expect(201)
    await api().post(`/posts/${post.id}/comments`).send(body).expect(201)
    const blocked = await api().post(`/posts/${post.id}/comments`).send(body).expect(429)

    assert.deepEqual(blocked.body, { message: "Too Many Requests" })
    assert.ok(Number(blocked.headers["retry-after"]) > 0)

    const { rowCount } = await pool.query("SELECT 1 FROM comments")
    assert.equal(rowCount, 2)
  })

  it("curtidas e comentários têm cotas separadas", async () => {
    const api = buildApi()
    const post = await seedPost(APPROVED)

    await api().post(`/posts/${post.id}/likes`).set(visitor("ana")).expect(201)
    await api().post(`/posts/${post.id}/likes`).set(visitor("bia")).expect(201)
    await api().post(`/posts/${post.id}/likes`).set(visitor("caio")).expect(429)

    await api()
      .post(`/posts/${post.id}/comments`)
      .send({ author_name: "Ana", content: "Ainda posso comentar" })
      .expect(201)

    const { rowCount } = await pool.query("SELECT 1 FROM post_likes")
    assert.equal(rowCount, 2)
  })
})
