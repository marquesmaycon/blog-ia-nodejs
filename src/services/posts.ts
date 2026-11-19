import { z } from "zod"

import { POST_WRITER_AGENT_ID } from "../mastra/agents/post-writer.ts"
import { mastra } from "../mastra/index.ts"
import {
  approvePostById,
  findAllPosts,
  findPostById,
  insertPost,
  rejectPostById,
  type Post
} from "../repositories/posts.ts"

const generatedPostSchema = z.object({
  title: z.string().min(1).describe("Título do post, curto e chamativo"),
  content: z.string().min(1).describe("Corpo completo do post em Markdown")
})

export async function listPosts(): Promise<Post[]> {
  return findAllPosts()
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
