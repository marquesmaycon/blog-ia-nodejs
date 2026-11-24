// Fluxo completo pela API HTTP (supertest), com Postgres real (banco blog_test).
// Só o LLM é substituído: chamar o provedor de verdade deixaria o teste lento, caro e
// não determinístico. O mock é feito no mastra.getAgent, a fronteira com o serviço externo.
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { mastra } from "../../src/mastra/index.ts"
import type { Post } from "../../src/repositories/posts.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerPostRoutes(app)
const api = () => request(app.server)

function mockPostWriter(generate: () => Promise<unknown>) {
  return mock.method(mastra, "getAgent", (() => ({ generate })) as never)
}

function mockGeneratedPost(title: string, content = `## ${title}\n\nConteúdo.`) {
  return mockPostWriter(async () => ({ object: { title, content } }))
}

async function createDraft(idea: string): Promise<Post> {
  mockGeneratedPost(`Post sobre ${idea}`)
  const res = await api().post("/posts/draft").set(auth).send({ idea }).expect(201)
  return res.body.data
}

describe("E2E /posts", () => {
  beforeEach(truncatePosts)
  afterEach(() => mock.restoreAll())
  after(() => pool.end())

  it("ciclo de vida: rascunho → aprovado → reprovado", async () => {
    // 1. Gera o rascunho
    mockGeneratedPost("Testes com node:test", "## Intro\n\nTexto.")
    const created = await api()
      .post("/posts/draft")
      .set(auth)
      .send({ idea: "testes no node" })
      .expect(201)

    const draft: Post = created.body.data
    assert.equal(created.body.message, "Post draft created")
    assert.equal(draft.title, "Testes com node:test")
    assert.equal(draft.content, "## Intro\n\nTexto.")
    assert.equal(draft.approved_at, null)

    // 2. Rascunho não aparece na listagem pública, mas aparece com include=all
    assert.deepEqual((await api().get("/posts").expect(200)).body, {
      data: [],
      meta: { page: 1, limit: 10, total: 0 }
    })

    const all = await api().get("/posts?include=all").set(auth).expect(200)
    assert.deepEqual(
      all.body.data.map((post: Post) => post.id),
      [draft.id]
    )

    // 3. Busca direta pelo id funciona mesmo sendo rascunho
    const fetched = await api().get(`/posts/${draft.id}`).expect(200)
    assert.deepEqual(fetched.body.data, draft)

    // 4. Aprova: passa a aparecer na listagem pública
    const approved = await api().patch(`/posts/${draft.id}/approve`).set(auth).expect(200)
    assert.equal(approved.body.message, "Post approved")
    assert.ok(approved.body.data.approved_at)

    const publicList = await api().get("/posts").expect(200)
    assert.deepEqual(
      publicList.body.data.map((post: Post) => post.id),
      [draft.id]
    )

    // 5. Reprova: some da listagem pública, continua existindo
    const rejected = await api().delete(`/posts/${draft.id}/reject`).set(auth).expect(200)
    assert.equal(rejected.body.message, "Post rejected")
    assert.equal(rejected.body.data.approved_at, null)
    assert.ok(rejected.body.data.rejected_at)

    assert.deepEqual((await api().get("/posts").expect(200)).body, {
      data: [],
      meta: { page: 1, limit: 10, total: 0 }
    })
    await api().get(`/posts/${draft.id}`).expect(200)

    // 6. Pode ser aprovado de novo
    const reapproved = await api().patch(`/posts/${draft.id}/approve`).set(auth).expect(200)
    assert.equal(reapproved.body.data.rejected_at, null)
  })

  it("listagem pública traz só aprovados, do mais recente para o mais antigo", async () => {
    const first = await createDraft("primeiro")
    const second = await createDraft("segundo")
    await createDraft("rascunho")

    await api().patch(`/posts/${first.id}/approve`).set(auth).expect(200)
    await api().patch(`/posts/${second.id}/approve`).set(auth).expect(200)

    const res = await api().get("/posts").expect(200)

    assert.deepEqual(
      res.body.data.map((post: Post) => post.id),
      [second.id, first.id]
    )
  })

  it("pagina e busca a listagem pública, com meta coerente", async () => {
    const titles = ["Streams no Node", "Testes com node:test", "Filas com BullMQ"]
    for (const title of titles) {
      mockGeneratedPost(
        title,
        `## ${title}

Conteúdo sobre ${title}.`
      )
      const res = await api().post("/posts/draft").set(auth).send({ idea: title }).expect(201)
      await api().patch(`/posts/${res.body.data.id}/approve`).set(auth).expect(200)
    }

    // Aprovados em sequência: o mais recente vem primeiro
    const page1 = await api().get("/posts?limit=2").expect(200)
    const page2 = await api().get("/posts?limit=2&page=2").expect(200)
    const page3 = await api().get("/posts?limit=2&page=3").expect(200)

    assert.deepEqual(
      [...page1.body.data, ...page2.body.data].map((post: Post) => post.title),
      titles.toReversed()
    )
    assert.deepEqual(page1.body.meta, { page: 1, limit: 2, total: 3 })
    assert.deepEqual(page2.body.meta, { page: 2, limit: 2, total: 3 })
    assert.deepEqual(page3.body, { data: [], meta: { page: 3, limit: 2, total: 3 } })

    const search = await api().get("/posts?q=testes").expect(200)
    assert.deepEqual(
      search.body.data.map((post: Post) => post.title),
      ["Testes com node:test"]
    )
    assert.equal(search.body.meta.total, 1)

    await api().get("/posts?limit=0").expect(400)
    await api().get("/posts?page=abc").expect(400)
  })

  describe("autorização de include=all", () => {
    it("responde 403 sem API key", async () => {
      await api().get("/posts?include=all").expect(403, { message: "Forbidden" })
    })

    it("responde 403 com API key errada", async () => {
      await api().get("/posts?include=all").set("Authorization", "Bearer errada").expect(403)
    })

    it("responde 400 para valor inválido de include", async () => {
      await api().get("/posts?include=tudo").set(auth).expect(400)
    })
  })

  describe("autorização das rotas administrativas", () => {
    it("responde 403 sem API key ao aprovar ou reprovar, sem alterar o post", async () => {
      const draft = await createDraft("protegido")
      const forbidden = { message: "Forbidden" }

      await api().patch(`/posts/${draft.id}/approve`).expect(403, forbidden)
      await api().delete(`/posts/${draft.id}/reject`).expect(403, forbidden)

      const fetched = await api().get(`/posts/${draft.id}`).expect(200)
      assert.deepEqual(fetched.body.data, draft)
    })

    it("responde 403 sem API key ao gerar rascunho e não chama o LLM", async () => {
      const getAgent = mockGeneratedPost("não deveria gerar")

      await api().post("/posts/draft").send({ idea: "qualquer" }).expect(403)
      await api()
        .post("/posts/draft")
        .set("Authorization", "Bearer errada")
        .send({ idea: "qualquer" })
        .expect(403)

      assert.equal(getAgent.mock.callCount(), 0)
    })
  })

  describe("erros", () => {
    it("responde 404 para post inexistente em todas as rotas por id", async () => {
      const notFound = { message: "Post not found" }

      await api().get("/posts/inexistente").expect(404, notFound)
      await api().patch("/posts/inexistente/approve").set(auth).expect(404, notFound)
      await api().delete("/posts/inexistente/reject").set(auth).expect(404, notFound)
    })

    it("responde 404 para rota inexistente", async () => {
      await api().get("/nada").expect(404, { message: "Not Found" })
    })

    it("responde 400 para JSON inválido", async () => {
      await api()
        .post("/posts/draft")
        .set(auth)
        .set("Content-Type", "application/json")
        .send("{idea")
        .expect(400, { message: "Invalid JSON body" })
    })

    it("responde 400 sem a ideia e não chama o LLM", async () => {
      const getAgent = mockGeneratedPost("não deveria gerar")

      await api().post("/posts/draft").set(auth).send({ idea: "" }).expect(400)

      assert.equal(getAgent.mock.callCount(), 0)
    })

    it("responde 502 quando o LLM falha e não persiste nada", async (t) => {
      t.mock.method(console, "error", () => {})
      mockPostWriter(async () => {
        throw new Error("LLM indisponível")
      })

      await api()
        .post("/posts/draft")
        .set(auth)
        .send({ idea: "qualquer" })
        .expect(502, { message: "Failed to generate post" })

      const all = await api().get("/posts?include=all").set(auth).expect(200)
      assert.deepEqual(all.body.data, [])
    })
  })
})
