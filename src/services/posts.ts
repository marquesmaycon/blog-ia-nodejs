import { nanoid } from "nanoid"
import { z } from "zod"

import { POST_WRITER_AGENT_ID } from "../mastra/agents/post-writer.ts"
import { mastra } from "../mastra/index.ts"

export type Post = {
  id: string
  title: string
  content: string
  published_at: string
  approved_at: string | null
  rejected_at: string | null
}

const generatedPostSchema = z.object({
  title: z.string().min(1).describe("Título do post, curto e chamativo"),
  content: z.string().min(1).describe("Corpo completo do post em Markdown")
})

export const posts: Post[] = []

export async function createPostDraft(idea: string): Promise<Post> {
  const agent = mastra.getAgent(POST_WRITER_AGENT_ID)
  const { object } = await agent.generate(`Ideia do post: ${idea}`, {
    structuredOutput: { schema: generatedPostSchema }
  })

  const post: Post = {
    id: nanoid(),
    title: object.title,
    content: object.content,
    published_at: new Date().toISOString(),
    approved_at: null,
    rejected_at: null
  }
  posts.push(post)

  return post
}
