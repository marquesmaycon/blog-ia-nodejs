import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import type { Post } from "../../repositories/posts.ts"

// Os repositórios são carregados só na execução: importar o pool do Postgres no topo faria
// o registro do Mastra (src/mastra/index.ts) exigir DATABASE_URL, inclusive nos testes unitários.
const loadPosts = () => import("../../repositories/posts.ts")
const loadTags = () => import("../../repositories/tags.ts")

// Versão enxuta do post para o modelo: sem o conteúdo, que gastaria tokens à toa
const postSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  tags: z.array(z.string())
})

const popularPostSchema = postSummarySchema.extend({
  recent_likes: z.number(),
  likes_count: z.number(),
  comments_count: z.number()
})

export type EditorialPostSummary = z.infer<typeof postSummarySchema>

function toSummary(post: Post): EditorialPostSummary {
  return {
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    tags: post.tags.map((tag) => tag.name)
  }
}

export const getPopularPosts = createTool({
  id: "get-popular-posts",
  description:
    "Lista os posts publicados com mais curtidas nos últimos `days` dias, com as contagens de curtidas e comentários aprovados.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(365).default(30).describe("Janela em dias"),
    limit: z.number().int().min(1).max(20).default(10).describe("Quantidade máxima de posts")
  }),
  outputSchema: z.object({ posts: z.array(popularPostSchema) }),
  execute: async ({ days, limit }) => {
    const { findPopularPosts } = await loadPosts()
    const posts = await findPopularPosts({ days, limit })

    return {
      posts: posts.map((post) => ({
        ...toSummary(post),
        recent_likes: post.recent_likes,
        likes_count: post.likes_count,
        comments_count: post.comments_count
      }))
    }
  }
})

export const listTags = createTool({
  id: "list-tags",
  description: "Lista as tags com posts publicados e quantos posts cada uma tem.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    tags: z.array(z.object({ name: z.string(), slug: z.string(), posts_count: z.number() }))
  }),
  execute: async () => {
    const { findTagsWithApprovedPosts } = await loadTags()
    return { tags: await findTagsWithApprovedPosts() }
  }
})

export const searchPosts = createTool({
  id: "search-posts",
  description:
    "Busca full-text nos posts publicados. Use para conferir se um tema já foi coberto antes de sugeri-lo.",
  inputSchema: z.object({
    q: z.string().trim().min(1).max(200).describe("Termos da busca"),
    limit: z.number().int().min(1).max(10).default(5).describe("Quantidade máxima de posts")
  }),
  outputSchema: z.object({ posts: z.array(postSummarySchema) }),
  execute: async ({ q, limit }) => {
    const { findPosts } = await loadPosts()
    const { posts } = await findPosts({ approvedOnly: true, q }, { limit, offset: 0 })

    return { posts: posts.map(toSummary) }
  }
})

// As chaves são os nomes que o modelo vê ao chamar as tools
export const editorialTools = { getPopularPosts, listTags, searchPosts }
