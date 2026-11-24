// Fluxo completo de tags pela API HTTP (supertest), com Postgres real (banco blog_test).
import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import type { Post } from "../../src/repositories/posts.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { registerTagRoutes } from "../../src/routes/tags.ts"
import { pool, seedPost, truncatePosts } from "../helpers/db.ts"

const app = createApp()
registerPostRoutes(app)
registerTagRoutes(app)
const api = () => request(app.server)

const auth = { Authorization: "Bearer e2e-secret" }

const NODE = { name: "Node.js", slug: "node-js" }
const IA = { name: "IA", slug: "ia" }

const idsOf = (posts: Post[]) => posts.map((post) => post.id)

describe("E2E tags", () => {
  const originalApiKey = process.env.API_KEY

  before(() => {
    process.env.API_KEY = "e2e-secret"
  })

  beforeEach(truncatePosts)

  after(async () => {
    if (originalApiKey === undefined) delete process.env.API_KEY
    else process.env.API_KEY = originalApiKey
    await pool.end()
  })

  it("ciclo de vida: taggear rascunho, aprovar, filtrar, listar e apagar a tag", async () => {
    const draft = await seedPost()
    const other = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

    // 1. O admin taggeia o rascunho; nomes com o mesmo slug viram uma tag só
    const tagged = await api()
      .put(`/posts/${draft.id}/tags`)
      .set(auth)
      .send({ tags: ["Node.js", "IA", "node js"] })
      .expect(200)
    assert.equal(tagged.body.message, "Post tags updated")
    assert.deepEqual(tagged.body.data.tags, [IA, NODE])

    // 2. Enquanto é rascunho, a tag não aparece no público
    assert.deepEqual((await api().get("/tags").expect(200)).body.data, [])
    assert.deepEqual((await api().get("/posts?tag=node-js").expect(200)).body.data, [])

    // 3. O admin vê o rascunho filtrando com include=all
    const all = await api().get("/posts?include=all&tag=node-js").set(auth).expect(200)
    assert.deepEqual(idsOf(all.body.data), [draft.id])

    // 4. Depois de aprovado, entra no filtro público e na listagem de tags
    await api().patch(`/posts/${draft.id}/approve`).set(auth).expect(200)
    await api()
      .put(`/posts/${other.id}/tags`)
      .set(auth)
      .send({ tags: ["IA"] })
      .expect(200)

    const filtered = await api().get("/posts?tag=node-js").expect(200)
    assert.deepEqual(idsOf(filtered.body.data), [draft.id])

    assert.deepEqual((await api().get("/tags").expect(200)).body.data, [
      { ...IA, posts_count: 2 },
      { ...NODE, posts_count: 1 }
    ])

    // 5. Apagar a tag a remove dos posts
    await api().delete("/tags/node-js").set(auth).expect(200)
    const post = await api().get(`/posts/${draft.id}`).expect(200)
    assert.deepEqual(post.body.data.tags, [IA])
    await api().delete("/tags/node-js").set(auth).expect(404)
  })

  it("PUT com lista vazia remove as tags do post", async () => {
    const post = await seedPost()
    await api()
      .put(`/posts/${post.id}/tags`)
      .set(auth)
      .send({ tags: ["IA"] })
      .expect(200)

    const cleared = await api()
      .put(`/posts/${post.id}/tags`)
      .set(auth)
      .send({ tags: [] })
      .expect(200)

    assert.deepEqual(cleared.body.data.tags, [])
  })

  it("PUT em post inexistente responde 404 e não cria a tag", async () => {
    await api()
      .put("/posts/missing/tags")
      .set(auth)
      .send({ tags: ["IA"] })
      .expect(404)

    const { rows } = await pool.query("SELECT 1 FROM tags")
    assert.equal(rows.length, 0)
  })

  it("rotas administrativas respondem 403 sem API key", async () => {
    const post = await seedPost()

    await api()
      .put(`/posts/${post.id}/tags`)
      .send({ tags: ["IA"] })
      .expect(403)
    await api().delete("/tags/ia").expect(403)
  })

  it("GET /posts responde 400 para tag que não é slug", async () => {
    const res = await api().get("/posts?tag=Node.js").expect(400)

    assert.equal(res.body.errors[0].field, "tag")
  })
})
