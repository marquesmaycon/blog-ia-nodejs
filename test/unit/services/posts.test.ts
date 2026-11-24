// Testa as regras do service isoladamente: repositório e Mastra são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type {
  FindPostsFilters,
  NewPost,
  Pagination,
  Post,
  PostsPage
} from "../../../src/repositories/posts.ts"

const post: Post = {
  id: "abc",
  title: "Título",
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
  insertPost: mock.fn(async (data: NewPost): Promise<Post> => ({ ...post, ...data })),
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

const { approvePost, createPostDraft, getPost, listPosts, rejectPost } =
  await import("../../../src/services/posts.ts")

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
        { title: "Gerado", content: "## Corpo" }
      ])
      assert.equal(result.title, "Gerado")
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
