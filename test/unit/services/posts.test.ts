// Testa as regras do service isoladamente: repositório e Mastra são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type {
  DraftChanges,
  FindPostsFilters,
  NewPost,
  Pagination,
  Post,
  PostsPage
} from "../../../src/repositories/posts.ts"

const post: Post = {
  id: "abc",
  slug: "titulo",
  title: "Título",
  reading_time_minutes: 1,
  content: "Conteúdo",
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: null,
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: []
}

const repository = {
  findPosts: mock.fn(
    async (_filters: FindPostsFilters, _pagination: Pagination): Promise<PostsPage> => ({
      posts: [post],
      total: 23
    })
  ),
  findPostById: mock.fn(async (_id: string): Promise<Post | null> => post),
  findPublishedPostBySlug: mock.fn(async (_slug: string): Promise<Post | null> => post),
  findTakenSlugs: mock.fn(async (_base: string, _excludeId?: string): Promise<string[]> => []),
  insertPost: mock.fn(async (data: NewPost): Promise<Post> => ({ ...post, ...data })),
  updateDraftById: mock.fn(async (_id: string, data: DraftChanges): Promise<Post | null> => ({
    ...post,
    ...data
  })),
  approvePostById: mock.fn(async (_id: string): Promise<Post | null> => post),
  rejectPostById: mock.fn(async (_id: string): Promise<Post | null> => post)
}

const generate = mock.fn(async (_prompt: string, _options: unknown) => ({
  object: { title: "Gerado", content: "## Corpo" }
}))
const getAgent = mock.fn((_id: string) => ({ generate }))

mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: repository })
mock.module(import.meta.resolve("../../../src/mastra/index.ts"), {
  exports: { mastra: { getAgent } }
})
mock.module(import.meta.resolve("../../../src/mastra/agents/post-writer.ts"), {
  exports: { POST_WRITER_AGENT_ID: "post-writer" }
})

const {
  approvePost,
  createPostDraft,
  generateUniqueSlug,
  getPost,
  getPublishedPostBySlug,
  listPosts,
  rejectPost,
  updatePostDraft
} = await import("../../../src/services/posts.ts")

const slugConflict = () =>
  Object.assign(new Error("duplicate key"), { code: "23505", constraint: "posts_slug_key" })

const APPROVED_AT = "2026-01-02T00:00:00.000Z"

describe("services/posts", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(repository), generate, getAgent]) fn.mock.resetCalls()
  })

  describe("listPosts", () => {
    it("busca apenas aprovados, na primeira página com o limite padrão", async () => {
      const result = await listPosts()

      assert.deepEqual(result, { data: [post], meta: { page: 1, limit: 10, total: 23 } })
      assert.deepEqual(repository.findPosts.mock.calls[0].arguments, [
        { approvedOnly: true, tag: undefined, q: undefined },
        { limit: 10, offset: 0 }
      ])
    })

    it("busca todos com includeAll", async () => {
      await listPosts({ includeAll: true })

      assert.equal(repository.findPosts.mock.calls[0].arguments[0].approvedOnly, false)
    })

    it("repassa tag e q ao repositório", async () => {
      await listPosts({ tag: "node-js", q: "streams" })

      assert.deepEqual(repository.findPosts.mock.calls[0].arguments[0], {
        approvedOnly: true,
        tag: "node-js",
        q: "streams"
      })
    })

    it("converte page e limit em offset e devolve no meta", async () => {
      const result = await listPosts({ page: 3, limit: 5 })

      assert.deepEqual(repository.findPosts.mock.calls[0].arguments[1], { limit: 5, offset: 10 })
      assert.deepEqual(result.meta, { page: 3, limit: 5, total: 23 })
    })
  })

  describe("getPost / approvePost / rejectPost", () => {
    it("delegam ao repositório com o id", async () => {
      await getPost("1")
      await approvePost("2")
      await rejectPost("3")

      assert.deepEqual(repository.findPostById.mock.calls[0].arguments, ["1"])
      assert.deepEqual(repository.approvePostById.mock.calls[0].arguments, ["2"])
      assert.deepEqual(repository.rejectPostById.mock.calls[0].arguments, ["3"])
    })

    it("propagam null quando o post não existe", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => null)

      assert.equal(await getPost("missing"), null)
    })
  })

  describe("createPostDraft", () => {
    it("gera o post com o agente post-writer e persiste o resultado", async () => {
      const result = await createPostDraft("testes com node")

      assert.deepEqual(getAgent.mock.calls[0].arguments, ["post-writer"])

      const [prompt, options] = generate.mock.calls[0].arguments
      assert.match(prompt, /testes com node/)
      assert.ok((options as { structuredOutput?: { schema?: unknown } }).structuredOutput?.schema)

      assert.deepEqual(repository.insertPost.mock.calls[0].arguments, [
        { title: "Gerado", content: "## Corpo", slug: "gerado", reading_time_minutes: 1 }
      ])
      assert.equal(result.title, "Gerado")
    })

    it("calcula o tempo de leitura a partir do conteúdo gerado", async () => {
      generate.mock.mockImplementationOnce(async () => ({
        object: { title: "Longo", content: "palavra ".repeat(401) }
      }))

      await createPostDraft("ideia")

      assert.equal(repository.insertPost.mock.calls[0].arguments[0].reading_time_minutes, 3)
    })

    it("gera outro slug e tenta de novo quando o insert colide no UNIQUE", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => [], 0)
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["gerado"], 1)
      repository.insertPost.mock.mockImplementationOnce(async () => {
        throw slugConflict()
      })

      const result = await createPostDraft("ideia")

      assert.equal(repository.insertPost.mock.callCount(), 2)
      assert.equal(result.slug, "gerado-2")
    })

    it("desiste depois de 3 colisões seguidas", async () => {
      for (const call of [0, 1, 2]) {
        repository.insertPost.mock.mockImplementationOnce(async () => {
          throw slugConflict()
        }, call)
      }

      await assert.rejects(createPostDraft("ideia"), { code: "23505" })
      assert.equal(repository.insertPost.mock.callCount(), 3)
    })

    it("não tenta de novo em outros erros do banco", async () => {
      repository.insertPost.mock.mockImplementationOnce(async () => {
        throw Object.assign(new Error("fk"), { code: "23503" })
      })

      await assert.rejects(createPostDraft("ideia"), /fk/)
      assert.equal(repository.insertPost.mock.callCount(), 1)
    })
  })

  describe("generateUniqueSlug", () => {
    it("usa o slug do título quando está livre", async () => {
      assert.equal(await generateUniqueSlug("Programação Funcional"), "programacao-funcional")
      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, [
        "programacao-funcional",
        undefined
      ])
    })

    it("soma 1 ao maior sufixo em uso", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => [
        "node",
        "node-2",
        "node-10"
      ])

      assert.equal(await generateUniqueSlug("Node"), "node-11")
    })

    it("usa -2 quando só a base está em uso", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["node"])

      assert.equal(await generateUniqueSlug("Node"), "node-2")
    })

    it("mantém a base quando só variações numéricas estão em uso", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["node-2"])

      assert.equal(await generateUniqueSlug("Node"), "node")
    })

    it('cai em "post" quando o título não gera slug', async () => {
      assert.equal(await generateUniqueSlug("!!!"), "post")
    })

    it("limita a 80 caracteres sem deixar hífen no fim", async () => {
      assert.equal(await generateUniqueSlug(`${"a".repeat(79)} bcd`), "a".repeat(79))
    })

    it("repassa o excludeId", async () => {
      await generateUniqueSlug("Node", "abc")

      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, ["node", "abc"])
    })
  })

  describe("getPublishedPostBySlug", () => {
    it("delega ao repositório", async () => {
      assert.equal(await getPublishedPostBySlug("titulo"), post)
      assert.deepEqual(repository.findPublishedPostBySlug.mock.calls[0].arguments, ["titulo"])
    })
  })

  describe("updatePostDraft", () => {
    it("responde not_found quando o post não existe", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => null)

      assert.deepEqual(await updatePostDraft("missing", { title: "T", content: "C" }), {
        status: "not_found"
      })
      assert.equal(repository.updateDraftById.mock.callCount(), 0)
    })

    it("responde approved quando o post já foi aprovado", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => ({
        ...post,
        approved_at: APPROVED_AT
      }))

      assert.deepEqual(await updatePostDraft("abc", { title: "T", content: "C" }), {
        status: "approved"
      })
      assert.equal(repository.updateDraftById.mock.callCount(), 0)
    })

    it("regera o slug (ignorando o próprio post) quando o título muda", async () => {
      const result = await updatePostDraft("abc", { title: "Novo Título", content: "Texto" })

      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, ["novo-titulo", "abc"])
      assert.deepEqual(repository.updateDraftById.mock.calls[0].arguments, [
        "abc",
        { title: "Novo Título", content: "Texto", slug: "novo-titulo", reading_time_minutes: 1 }
      ])
      assert.equal(result.status, "updated")
    })

    it("mantém o slug quando o título não muda e recalcula o tempo de leitura", async () => {
      const content = "palavra ".repeat(250)

      await updatePostDraft("abc", { title: post.title, content })

      assert.equal(repository.findTakenSlugs.mock.callCount(), 0)
      assert.deepEqual(repository.updateDraftById.mock.calls[0].arguments, [
        "abc",
        { title: post.title, content, slug: "titulo", reading_time_minutes: 2 }
      ])
    })

    it("responde approved quando o post foi aprovado entre a leitura e o update", async () => {
      repository.updateDraftById.mock.mockImplementationOnce(async () => null)
      repository.findPostById.mock.mockImplementationOnce(async () => post, 0)
      repository.findPostById.mock.mockImplementationOnce(
        async () => ({ ...post, approved_at: APPROVED_AT }),
        1
      )

      assert.deepEqual(await updatePostDraft("abc", { title: post.title, content: "C" }), {
        status: "approved"
      })
    })

    it("responde not_found quando o post sumiu entre a leitura e o update", async () => {
      repository.updateDraftById.mock.mockImplementationOnce(async () => null)
      repository.findPostById.mock.mockImplementationOnce(async () => post, 0)
      repository.findPostById.mock.mockImplementationOnce(async () => null, 1)

      assert.deepEqual(await updatePostDraft("abc", { title: post.title, content: "C" }), {
        status: "not_found"
      })
    })

    it("não persiste nada quando a geração falha", async () => {
      generate.mock.mockImplementationOnce(async () => {
        throw new Error("LLM indisponível")
      })

      await assert.rejects(createPostDraft("ideia"), /LLM indisponível/)
      assert.equal(repository.insertPost.mock.callCount(), 0)
    })
  })
})
