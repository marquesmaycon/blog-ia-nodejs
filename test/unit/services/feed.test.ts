// Testa o feed isoladamente: o repositório é substituído por mock.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import type {
  FindPostsFilters,
  Pagination,
  Post,
  PostsPage
} from "../../../src/repositories/posts.ts"

const post: Post = {
  id: "post-1",
  slug: "testes-com-node",
  title: "Testes & <Node>",
  content: "# Título\n\nUm **texto** com [link](https://x.dev) e `código`.",
  reading_time_minutes: 1,
  published_at: "2026-01-05T12:00:00.000Z",
  approved_at: "2026-01-05T12:00:00.000Z",
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: []
}

const repository = {
  findPosts: mock.fn(
    async (_filters: FindPostsFilters, _pagination: Pagination): Promise<PostsPage> => ({
      posts: [post],
      total: 1
    })
  )
}

mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: repository })

const { buildRssFeed, escapeXml, excerpt, FEED_SIZE, getFeed, siteUrl } =
  await import("../../../src/services/feed.ts")

describe("services/feed", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    repository.findPosts.mock.resetCalls()
    delete process.env.SITE_URL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe("escapeXml", () => {
    it("escapa os cinco caracteres reservados", () => {
      assert.equal(escapeXml(`a & b < c > d " e ' f`), "a &amp; b &lt; c &gt; d &quot; e &apos; f")
    })
  })

  describe("excerpt", () => {
    it("tira a marcação Markdown e junta as linhas", () => {
      assert.equal(excerpt(post.content), "Título Um texto com link e código.")
    })

    it("remove blocos de código e imagens", () => {
      assert.equal(excerpt("Antes\n```js\nconst x = 1\n```\n![alt](a.png) depois"), "Antes depois")
    })

    it("corta no limite com reticências", () => {
      assert.equal(excerpt("abcdef ghij", 6), "abcdef…")
    })
  })

  describe("siteUrl", () => {
    it("usa SITE_URL sem a barra final", () => {
      process.env.SITE_URL = "https://blog.dev/"

      assert.equal(siteUrl(), "https://blog.dev")
    })

    it("cai no endereço da API sem SITE_URL", () => {
      process.env.API_PROTOCOL = "http"
      process.env.API_HOST = "localhost"
      process.env.API_PORT = "3000"

      assert.equal(siteUrl(), "http://localhost:3000")
    })
  })

  describe("buildRssFeed", () => {
    it("monta um item por post com link pelo slug e campos escapados", () => {
      const xml = buildRssFeed([post], "https://blog.dev")

      assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
      assert.match(xml, /<title>Testes &amp; &lt;Node&gt;<\/title>/)
      assert.match(xml, /<link>https:\/\/blog.dev\/posts\/slug\/testes-com-node<\/link>/)
      assert.match(
        xml,
        /<guid isPermaLink="true">https:\/\/blog.dev\/posts\/slug\/testes-com-node<\/guid>/
      )
      assert.match(xml, /<pubDate>Mon, 05 Jan 2026 12:00:00 GMT<\/pubDate>/)
      assert.match(xml, /<description>Título Um texto com link e código.<\/description>/)
      assert.match(xml, /<lastBuildDate>Mon, 05 Jan 2026 12:00:00 GMT<\/lastBuildDate>/)
    })

    it("gera um canal válido sem itens quando não há posts", () => {
      const xml = buildRssFeed([], "https://blog.dev")

      assert.match(xml, /<channel>/)
      assert.doesNotMatch(xml, /<item>/)
    })
  })

  describe("getFeed", () => {
    it("busca os posts aprovados mais recentes na primeira página", async () => {
      process.env.SITE_URL = "https://blog.dev"

      const xml = await getFeed()

      assert.deepEqual(repository.findPosts.mock.calls[0].arguments, [
        { approvedOnly: true },
        { limit: FEED_SIZE, offset: 0 }
      ])
      assert.match(xml, /https:\/\/blog.dev\/posts\/slug\/testes-com-node/)
    })
  })
})
