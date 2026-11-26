// Fluxo do editor de pauta pela API HTTP (supertest), com Postgres real (banco blog_test).
// Só o LLM é substituído: o generate mockado chama as tools de verdade, contra o banco,
// e devolve os resultados no mesmo formato do Mastra (steps[].toolResults).
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { mastra } from "../../src/mastra/index.ts"
import { editorialTools } from "../../src/mastra/tools/editorial.ts"
import { registerEditorialRoutes } from "../../src/routes/editorial.ts"
import type { EditorialIdea } from "../../src/services/editorial.ts"
import { pool, seedLike, seedPost, seedPostTag, seedTag, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerEditorialRoutes(app)
const api = () => request(app.server)

const APPROVED = { approved_at: "2026-01-01T00:00:00.000Z" }

type ToolOutputs = {
  popular: unknown
  tags: unknown
  search: unknown
}

// O execute aceita o contexto do runtime; aqui ele não é usado
const call = (
  tool: { execute?: (input: never, context: never) => Promise<unknown> },
  input: object
) => tool.execute!(input as never, {} as never)

const toolResult = (toolName: string, result: unknown) => ({
  type: "tool-result",
  payload: { toolName, result }
})

// Simula o agente: consulta as tools como as instruções mandam e devolve `ideas`
function mockPlanner(ideas: (outputs: ToolOutputs) => EditorialIdea[], searchQuery = "streams") {
  let outputs: ToolOutputs | undefined

  const generate = async () => {
    const popular = await call(editorialTools.getPopularPosts, { days: 30 })
    const tags = await call(editorialTools.listTags, {})
    const search = await call(editorialTools.searchPosts, { q: searchQuery })
    outputs = { popular, tags, search }

    return {
      object: { ideas: ideas(outputs) },
      steps: [
        { toolResults: [toolResult("getPopularPosts", popular), toolResult("listTags", tags)] },
        { toolResults: [toolResult("searchPosts", search)] }
      ]
    }
  }

  mock.method(mastra, "getAgent", (() => ({ generate })) as never)
  return () => outputs
}

const idea = (overrides: Partial<EditorialIdea> = {}): EditorialIdea => ({
  title: "Testando streams",
  idea: "Um guia de testes de streams com node:test.",
  rationale: "O post de streams é o mais curtido.",
  suggested_tags: ["Node.js"],
  inspired_by: [],
  ...overrides
})

describe("E2E editor de pauta", () => {
  beforeEach(async () => {
    await truncatePosts()
    mock.method(console, "error", () => {})
  })
  afterEach(() => mock.restoreAll())
  after(() => pool.end())

  it("as tools leem o banco e só os slugs devolvidos por elas ficam em inspired_by", async () => {
    const streams = await seedPost({
      ...APPROVED,
      slug: "streams-no-node",
      title: "Streams no Node.js",
      content: "Como usar streams e pipelines",
      summary: "Guia de streams"
    })
    const draft = await seedPost({ slug: "rascunho-streams", title: "Streams avançado" })
    const nodeTag = await seedTag({ name: "Node.js" })
    await seedPostTag({ post_id: streams.id, tag_id: nodeTag.id })
    await seedLike({ post_id: streams.id })
    await seedLike({ post_id: streams.id })
    // Curtida no rascunho não o torna popular: só aprovados entram
    await seedLike({ post_id: draft.id })

    const outputs = mockPlanner(() => [
      idea({ inspired_by: ["streams-no-node", "rascunho-streams", "slug-inventado"] })
    ])

    const res = await api().post("/editorial/ideas").set(auth).send({ count: 3 }).expect(200)

    assert.deepEqual(res.body, { data: { ideas: [idea({ inspired_by: ["streams-no-node"] })] } })

    // O modelo vê a versão enxuta (sem conteúdo) e nunca os rascunhos
    assert.deepEqual(outputs(), {
      popular: {
        posts: [
          {
            slug: "streams-no-node",
            title: "Streams no Node.js",
            summary: "Guia de streams",
            tags: ["Node.js"],
            recent_likes: 2,
            likes_count: 2,
            comments_count: 0
          }
        ]
      },
      tags: { tags: [{ name: "Node.js", slug: "node-js", posts_count: 1 }] },
      search: {
        posts: [
          {
            slug: "streams-no-node",
            title: "Streams no Node.js",
            summary: "Guia de streams",
            tags: ["Node.js"]
          }
        ]
      }
    })
  })

  it("com o blog vazio, as tools devolvem listas vazias e nenhum slug é aceito", async () => {
    const outputs = mockPlanner(() => [idea({ inspired_by: ["qualquer"] })])

    const res = await api().post("/editorial/ideas").set(auth).expect(200)

    assert.deepEqual(res.body.data.ideas[0].inspired_by, [])
    assert.deepEqual(outputs(), {
      popular: { posts: [] },
      tags: { tags: [] },
      search: { posts: [] }
    })
  })

  it("responde 403 sem API key", async () => {
    await api().post("/editorial/ideas").expect(403, { message: "Forbidden" })
  })

  it("responde 400 com body inválido", async () => {
    const res = await api().post("/editorial/ideas").set(auth).send({ count: 0 }).expect(400)

    assert.equal(res.body.errors[0].field, "count")
  })

  it("responde 502 quando o agente falha", async () => {
    mock.method(mastra, "getAgent", (() => ({
      generate: async () => {
        throw new Error("LLM fora do ar")
      }
    })) as never)

    await api()
      .post("/editorial/ideas")
      .set(auth)
      .expect(502, { message: "Failed to generate ideas" })
  })
})
