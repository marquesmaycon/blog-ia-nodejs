// Testa as tools do editor de pauta: os repositórios são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type {
  FindPostsFilters,
  Pagination,
  PopularPost,
  Post
} from "../../../src/repositories/posts.ts"
import type { TagWithCount } from "../../../src/repositories/tags.ts"

const post: Post = {
  id: "post-1",
  slug: "streams",
  title: "Streams no Node.js",
  reading_time_minutes: 3,
  content: "Conteúdo longo que não deve ir para o modelo",
  summary: "Como usar streams",
  meta_description: null,
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: "2026-01-01T00:00:00.000Z",
  rejected_at: null,
  likes_count: 12,
  comments_count: 4,
  tags: [{ name: "Node.js", slug: "node-js" }]
}

const tag: TagWithCount = { name: "Node.js", slug: "node-js", posts_count: 2 }

const posts = {
  findPopularPosts: mock.fn(
    async (_options: { days: number; limit: number }): Promise<PopularPost[]> => [
      { ...post, recent_likes: 5 }
    ]
  ),
  findPosts: mock.fn(async (_filters: FindPostsFilters, _pagination: Pagination) => ({
    posts: [post],
    total: 1
  }))
}

const tags = {
  findTagsWithApprovedPosts: mock.fn(async (): Promise<TagWithCount[]> => [tag])
}

mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: posts })
mock.module(import.meta.resolve("../../../src/repositories/tags.ts"), { exports: tags })

const { editorialTools } = await import("../../../src/mastra/tools/editorial.ts")

// O contexto de execução só é preenchido pelo runtime do agente; nos testes não é usado
const run = <T>(tool: { execute?: (input: T, context: never) => Promise<unknown> }, input: T) =>
  tool.execute!(input, {} as never)

describe("mastra/tools/editorial", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(posts), ...Object.values(tags)]) fn.mock.resetCalls()
  })

  describe("getPopularPosts", () => {
    it("devolve os populares sem o conteúdo, com as contagens e os nomes das tags", async () => {
      const result = await run(editorialTools.getPopularPosts, { days: 7, limit: 3 })

      assert.deepEqual(result, {
        posts: [
          {
            slug: "streams",
            title: "Streams no Node.js",
            summary: "Como usar streams",
            tags: ["Node.js"],
            recent_likes: 5,
            likes_count: 12,
            comments_count: 4
          }
        ]
      })
      assert.deepEqual(posts.findPopularPosts.mock.calls[0].arguments, [{ days: 7, limit: 3 }])
    })

    it("usa 30 dias e 10 posts por padrão", async () => {
      await run(editorialTools.getPopularPosts, {} as never)

      assert.deepEqual(posts.findPopularPosts.mock.calls[0].arguments, [{ days: 30, limit: 10 }])
    })
  })

  describe("listTags", () => {
    it("devolve as tags com posts publicados", async () => {
      assert.deepEqual(await run(editorialTools.listTags, {}), { tags: [tag] })
    })
  })

  describe("searchPosts", () => {
    it("busca só entre os publicados, na primeira página, e devolve a versão enxuta", async () => {
      const result = await run(editorialTools.searchPosts, { q: "streams", limit: 2 })

      assert.deepEqual(result, {
        posts: [
          {
            slug: "streams",
            title: "Streams no Node.js",
            summary: "Como usar streams",
            tags: ["Node.js"]
          }
        ]
      })
      assert.deepEqual(posts.findPosts.mock.calls[0].arguments, [
        { approvedOnly: true, q: "streams" },
        { limit: 2, offset: 0 }
      ])
    })

    it("usa 5 posts por padrão", async () => {
      await run(editorialTools.searchPosts, { q: "streams" } as never)

      assert.deepEqual(posts.findPosts.mock.calls[0].arguments[1], { limit: 5, offset: 0 })
    })
  })
})
