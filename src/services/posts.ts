import { z } from "zod"

import { POST_WRITER_AGENT_ID } from "../mastra/agents/post-writer.ts"
import { mastra } from "../mastra/index.ts"
import {
  approvePostById,
  findPostById,
  findPosts,
  insertPost,
  rejectPostById,
  type Post,
  type PostFilters
} from "../repositories/posts.ts"

const generatedPostSchema = z.object({
  title: z.string().min(1).describe("Título do post, curto e chamativo"),
  content: z.string().min(1).describe("Corpo completo do post em Markdown")
})

export const DEFAULT_PAGE_LIMIT = 10
export const MAX_PAGE_LIMIT = 50

export type ListPostsOptions = PostFilters & {
  includeAll?: boolean
  // Começa em 1
  page?: number
  limit?: number
}

export type PaginationMeta = {
  page: number
  limit: number
  total: number
}

export type PaginatedPosts = {
  data: Post[]
  meta: PaginationMeta
}

export async function listPosts({
  includeAll = false,
  tag,
  q,
  page = 1,
  limit = DEFAULT_PAGE_LIMIT
}: ListPostsOptions = {}): Promise<PaginatedPosts> {
  const { posts, total } = await findPosts(
    { approvedOnly: !includeAll, tag, q },
    { limit, offset: (page - 1) * limit }
  )

  return { data: posts, meta: { page, limit, total } }
}

export async function getPost(id: string): Promise<Post | null> {
  return findPostById(id)
}

export async function createPostDraft(idea: string): Promise<Post> {
  const agent = mastra.getAgent(POST_WRITER_AGENT_ID)
  const { object } = await agent.generate(`Ideia do post: ${idea}`, {
    structuredOutput: { schema: generatedPostSchema }
  })

  return insertPost(object)
}

export async function approvePost(id: string): Promise<Post | null> {
  return approvePostById(id)
}

export async function rejectPost(id: string): Promise<Post | null> {
  return rejectPostById(id)
}
