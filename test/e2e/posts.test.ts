// Fluxo completo pela API HTTP (supertest), com Postgres real (banco blog_test).
// Só o LLM é substituído: chamar o provedor de verdade deixaria o teste lento, caro e
// não determinístico. O mock é feito no mastra.getAgent, a fronteira com o serviço externo.
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { POST_REVIEWER_AGENT_ID } from "../../src/mastra/agents/post-reviewer.ts"
import { POST_SEO_AGENT_ID } from "../../src/mastra/agents/post-seo.ts"
import { mastra } from "../../src/mastra/index.ts"
import type { Post } from "../../src/repositories/posts.ts"
import { registerFeedRoutes } from "../../src/routes/feed.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerPostRoutes(app)
registerFeedRoutes(app)
const api = () => request(app.server)

// O revisor aprova de primeira por padrão, para cada rascunho custar uma escrita só
const approvingReview = async () => ({ object: { score: 9, issues: [], suggestions: [] } })

// Por padrão o SEO volta vazio: o slug sai do título e o post fica sem tags e sem summary
const emptySeo = async () => ({
  object: { summary: "", meta_description: "", slug: "", tags: [] }
})

function mockPostWriter(
  generate: () => Promise<unknown>,
  review: () => Promise<unknown> = approvingReview,
  seo: () => Promise<unknown> = emptySeo
) {
  const agents: Record<string, () => Promise<unknown>> = {
    [POST_REVIEWER_AGENT_ID]: review,
    [POST_SEO_AGENT_ID]: seo
  }
  return mock.method(mastra, "getAgent", ((id: string) => ({
    generate: agents[id] ?? generate
  })) as never)
}

function mockGeneratedPost(title: string, content = `## ${title}\n\nConteúdo.`) {
  return mockPostWriter(async () => ({ object: { title, content } }))
}

async function createDraft(idea: string): Promise<Post> {
  mockGeneratedPost(`Post sobre ${idea}`)
  const res = await api().post("/posts/draft").set(auth).send({ idea }).expect(201)
  // A revisão só vem na resposta da criação; o resto da API devolve o Post puro
  const { review: _review, ...post } = res.body.data
  return post
}

// Rascunho cujo SEO sugere estas tags
async function createDraftWithTags(idea: string, tags: string[]): Promise<Post> {
  mockPostWriter(
    async () => ({ object: { title: `Post sobre ${idea}`, content: "## Texto" } }),
    approvingReview,
    async () => ({ object: { summary: "", meta_description: "", slug: "", tags } })
  )
  const res = await api().post("/posts/draft").set(auth).send({ idea }).expect(201)
  mock.restoreAll()
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

    const { review, ...draft }: Post & { review: { score: number } } = created.body.data
    assert.equal(created.body.message, "Post draft created")
    assert.equal(review.score, 9)
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

  describe("slug, edição e tempo de leitura", () => {
    it("edita o rascunho, aprova e encontra pelo slug", async () => {
      // 1. Rascunho nasce com slug do título e tempo de leitura
      const draft = await createDraft("streams")
      assert.equal(draft.slug, "post-sobre-streams")
      assert.equal(draft.reading_time_minutes, 1)

      // 2. Rascunho não tem URL pública
      await api().get(`/posts/slug/${draft.slug}`).expect(404)

      // 3. Editar o título regera o slug e recalcula o tempo de leitura
      const content = Array.from({ length: 450 }, () => "palavra").join(" ")
      const edited = await api()
        .put(`/posts/${draft.id}`)
        .set(auth)
        .send({ title: "Streams no Node.js", content })
        .expect(200)

      assert.equal(edited.body.message, "Post updated")
      assert.equal(edited.body.data.slug, "streams-no-node-js")
      assert.equal(edited.body.data.reading_time_minutes, 3)

      // 4. Aprovado, aparece pelo slug e não pode mais ser editado
      await api().patch(`/posts/${draft.id}/approve`).set(auth).expect(200)

      const bySlug = await api().get("/posts/slug/streams-no-node-js").expect(200)
      assert.equal(bySlug.body.data.id, draft.id)
      assert.equal(bySlug.body.data.content, content)

      await api()
        .put(`/posts/${draft.id}`)
        .set(auth)
        .send({ title: "Outro", content: "Outro" })
        .expect(409, { message: "Approved posts cannot be edited" })
    })

    it("desempata títulos repetidos com sufixo numérico", async () => {
      const first = await createDraft("repetido")
      const second = await createDraft("repetido")
      const third = await createDraft("repetido")

      assert.deepEqual(
        [first.slug, second.slug, third.slug],
        ["post-sobre-repetido", "post-sobre-repetido-2", "post-sobre-repetido-3"]
      )
    })

    it("manter o título na edição preserva o slug", async () => {
      const draft = await createDraft("preservado")

      const edited = await api()
        .put(`/posts/${draft.id}`)
        .set(auth)
        .send({ title: draft.title, content: "Novo conteúdo" })
        .expect(200)

      assert.equal(edited.body.data.slug, draft.slug)
    })

    it("responde 403 sem API key ao editar, sem alterar o post", async () => {
      const draft = await createDraft("protegido")

      await api()
        .put(`/posts/${draft.id}`)
        .send({ title: "Invasão", content: "x" })
        .expect(403, { message: "Forbidden" })

      assert.equal((await api().get(`/posts/${draft.id}`).expect(200)).body.data.title, draft.title)
    })

    it("responde 404 ao editar post inexistente e 400 para slug inválido", async () => {
      await api()
        .put("/posts/inexistente")
        .set(auth)
        .send({ title: "T", content: "C" })
        .expect(404, { message: "Post not found" })

      await api().get("/posts/slug/Slug_Invalido").expect(400)
    })
  })

  describe("SEO do rascunho", () => {
    const generatedSeo = {
      summary: "Como processar arquivos grandes com streams.",
      meta_description: "Aprenda a usar streams no Node.js.",
      slug: "guia-de-streams",
      tags: ["Node.js", "Streams"]
    }

    it("grava slug, tags e metadados da IA, edita o summary e publica no feed", async () => {
      mockPostWriter(
        async () => ({ object: { title: "Streams no Node", content: "## Streams" } }),
        approvingReview,
        async () => ({ object: generatedSeo })
      )

      // 1. O rascunho nasce com o SEO gerado
      const created = await api().post("/posts/draft").set(auth).send({ idea: "streams" })
      assert.equal(created.status, 201)
      const draft: Post = created.body.data
      assert.equal(draft.slug, "guia-de-streams")
      assert.equal(draft.summary, generatedSeo.summary)
      assert.equal(draft.meta_description, generatedSeo.meta_description)
      assert.deepEqual(draft.tags, [
        { name: "Node.js", slug: "node-js" },
        { name: "Streams", slug: "streams" }
      ])

      // 2. Edita o summary; a meta_description ausente fica como estava
      const edited = await api()
        .put(`/posts/${draft.id}`)
        .set(auth)
        .send({ title: draft.title, content: draft.content, summary: "Resumo revisado." })
        .expect(200)
      assert.equal(edited.body.data.summary, "Resumo revisado.")
      assert.equal(edited.body.data.meta_description, generatedSeo.meta_description)
      assert.equal(edited.body.data.slug, "guia-de-streams")

      // 3. Aprovado, aparece no filtro pela tag sugerida e no RSS com o summary
      await api().patch(`/posts/${draft.id}/approve`).set(auth).expect(200)

      const byTag = await api().get("/posts?tag=streams").expect(200)
      assert.deepEqual(
        byTag.body.data.map((post: Post) => post.id),
        [draft.id]
      )

      const feed = await api().get("/feed.xml").expect(200)
      assert.match(feed.text, /<description>Resumo revisado.<\/description>/)
    })

    it("o agente recebe as tags que já existem", async () => {
      await createDraftWithTags("primeiro", ["Node.js"])
      const seo = mock.fn(async () => ({ object: generatedSeo }))
      mockPostWriter(
        async () => ({ object: { title: "Outro post", content: "## Texto" } }),
        approvingReview,
        seo
      )

      await api().post("/posts/draft").set(auth).send({ idea: "outro" }).expect(201)

      const [prompt] = seo.mock.calls[0].arguments as unknown as [string]
      assert.match(prompt, /Tags existentes: Node.js/)
    })

    it("sem SEO (o agente falhou), o rascunho sai com o slug do título e sem tags", async () => {
      mock.method(console, "error", () => {})
      mockPostWriter(
        async () => ({ object: { title: "Streams no Node", content: "## Streams" } }),
        approvingReview,
        async () => {
          throw new Error("SEO indisponível")
        }
      )

      const created = await api().post("/posts/draft").set(auth).send({ idea: "streams" })

      assert.equal(created.status, 201)
      assert.equal(created.body.data.slug, "streams-no-node")
      assert.equal(created.body.data.summary, null)
      assert.equal(created.body.data.meta_description, null)
      assert.deepEqual(created.body.data.tags, [])
    })

    it("responde 400 para summary longo demais na edição", async () => {
      const draft = await createDraft("limite")

      await api()
        .put(`/posts/${draft.id}`)
        .set(auth)
        .send({ title: draft.title, content: draft.content, summary: "x".repeat(301) })
        .expect(400)
    })
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
