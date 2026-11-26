import type { Post } from "../domain/posts.ts"
import { findPosts } from "../repositories/posts.ts"

export const FEED_SIZE = 20
const DESCRIPTION_LENGTH = 280

export type FeedPost = Pick<Post, "slug" | "title" | "content" | "summary" | "published_at">

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ENTITIES[char])
}

// Texto corrido para a <description> dos posts sem summary (antigos ou com falha no SEO):
// tira a marcação Markdown mais comum e corta no limite.
export function excerpt(markdown: string, maxLength = DESCRIPTION_LENGTH): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}…`
}

// URL pública do blog, usada nos links do feed
export function siteUrl(): string {
  const { SITE_URL, API_PROTOCOL = "http", API_HOST = "localhost", API_PORT = "8080" } = process.env
  return (SITE_URL || `${API_PROTOCOL}://${API_HOST}:${API_PORT}`).replace(/\/+$/, "")
}

// RSS 2.0 puro (sem I/O), com os posts na ordem recebida
export function buildRssFeed(posts: FeedPost[], baseUrl: string): string {
  const items = posts.map((post) => {
    const link = escapeXml(`${baseUrl}/posts/slug/${post.slug}`)

    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      <description>${escapeXml(post.summary ?? excerpt(post.content))}</description>
    </item>`
  })

  const lastBuildDate = posts[0] ? new Date(posts[0].published_at) : new Date()

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blog IA</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Posts publicados no blog</description>
    <language>pt-BR</language>
    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>
`
}

// Os FEED_SIZE posts aprovados mais recentes
export async function getFeed(): Promise<string> {
  const { posts } = await findPosts({ approvedOnly: true }, { limit: FEED_SIZE, offset: 0 })
  return buildRssFeed(posts, siteUrl())
}
