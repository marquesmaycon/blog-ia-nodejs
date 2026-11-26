// Fluxo do revisor de rascunhos pela API HTTP (supertest), com Postgres real (banco blog_test).
// Os agentes redator e revisor são mockados em mastra.getAgent; o workflow roda de verdade.
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { POST_REVIEWER_AGENT_ID } from "../../src/mastra/agents/post-reviewer.ts"
import { POST_SEO_AGENT_ID } from "../../src/mastra/agents/post-seo.ts"
import { mastra } from "../../src/mastra/index.ts"
import type { PostReview } from "../../src/repositories/post-reviews.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, seedPost, seedPostReview, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerPostRoutes(app)
const api = () => request(app.server)

// SEO vazio: o slug sai do título e os metadados ficam nulos
const emptySeo = async () => ({
  object: { summary: "", meta_description: "", slug: "", tags: [] }
})

// O redator numera as versões; o revisor devolve as notas na ordem (Error = falha)
function mockAgents(scores: (number | Error)[]) {
  let version = 0
  let reviewCall = 0

  const write = async () => {
    version++
    return { object: { title: `Versão ${version}`, content: `## Corpo ${version}` } }
  }
  const review = async () => {
    const next = scores[reviewCall++]
    if (next instanceof Error) throw next
    return {
      object: {
        score: next,
        issues: next < 7 ? [`problema ${reviewCall}`] : [],
        suggestions: next < 7 ? [`sugestão ${reviewCall}`] : []
      }
    }
  }

  const agents: Record<string, () => Promise<unknown>> = {
    [POST_REVIEWER_AGENT_ID]: review,
    [POST_SEO_AGENT_ID]: emptySeo
  }
  return mock.method(mastra, "getAgent", ((id: string) => ({
    generate: agents[id] ?? write
  })) as never)
}

const summary = (reviews: PostReview[]) =>
  reviews.map(({ attempt, score, issues }) => ({ attempt, score, issues }))

describe("E2E revisão de rascunhos", () => {
  beforeEach(async () => {
    await truncatePosts()
    mock.method(console, "error", () => {})
  })
  afterEach(() => mock.restoreAll())
  after(() => pool.end())

  it("reescreve abaixo da nota mínima e guarda o histórico das revisões", async () => {
    mockAgents([4, 8])

    // 1. Gera: a primeira versão leva 4, a reescrita leva 8 e é a que fica salva
    const created = await api().post("/posts/draft").set(auth).send({ idea: "streams" }).expect(201)

    const { review, ...draft } = created.body.data
    assert.equal(draft.title, "Versão 2")
    assert.equal(draft.approved_at, null)
    assert.equal(review.attempt, 2)
    assert.equal(review.score, 8)

    // 2. O admin consulta o histórico antes de aprovar
    const res = await api().get(`/posts/${draft.id}/review`).set(auth).expect(200)

    assert.deepEqual(res.body.data.latest, review)
    assert.deepEqual(summary(res.body.data.history), [
      { attempt: 1, score: 4, issues: ["problema 1"] },
      { attempt: 2, score: 8, issues: [] }
    ])

    // 3. O post salvo é a versão final
    const fetched = await api().get(`/posts/${draft.id}`).expect(200)
    assert.deepEqual(fetched.body.data, draft)
  })

  it("salva o rascunho sem revisão quando o revisor falha", async () => {
    mockAgents([new Error("revisor indisponível")])

    const created = await api().post("/posts/draft").set(auth).send({ idea: "streams" }).expect(201)

    assert.equal(created.body.data.title, "Versão 1")
    assert.equal(created.body.data.review, null)

    const res = await api().get(`/posts/${created.body.data.id}/review`).set(auth).expect(200)
    assert.deepEqual(res.body, { data: { latest: null, history: [] } })
  })

  it("não grava nada quando o redator falha", async () => {
    mock.method(mastra, "getAgent", (() => ({
      generate: async () => {
        throw new Error("LLM indisponível")
      }
    })) as never)

    await api().post("/posts/draft").set(auth).send({ idea: "streams" }).expect(502)

    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM posts")
    assert.equal(rows[0].total, 0)
  })

  it("GET /posts/:id/review devolve as revisões semeadas, com latest = a última", async () => {
    const post = await seedPost()
    await seedPostReview({ post_id: post.id, attempt: 2, score: 7 })
    await seedPostReview({ post_id: post.id, attempt: 1, score: 3, issues: ["raso"] })

    const res = await api().get(`/posts/${post.id}/review`).set(auth).expect(200)

    assert.equal(res.body.data.latest.attempt, 2)
    assert.deepEqual(summary(res.body.data.history), [
      { attempt: 1, score: 3, issues: ["raso"] },
      { attempt: 2, score: 7, issues: [] }
    ])
  })

  it("GET /posts/:id/review responde 404 para post inexistente e 403 sem API key", async () => {
    await api().get("/posts/nao-existe/review").set(auth).expect(404, { message: "Post not found" })

    const post = await seedPost()
    await api().get(`/posts/${post.id}/review`).expect(403, { message: "Forbidden" })
  })
})
