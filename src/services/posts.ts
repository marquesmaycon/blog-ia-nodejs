import { nanoid } from "nanoid"
import { z } from "zod"

import { pool } from "../db/index.ts"
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

const POST_COLUMNS = "id, title, content, published_at, approved_at, rejected_at"

export async function listPosts(): Promise<Post[]> {
  const { rows } = await pool.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts ORDER BY published_at DESC`
  )

  return rows
}

export async function createPostDraft(idea: string): Promise<Post> {
  const agent = mastra.getAgent(POST_WRITER_AGENT_ID)
  const { object } = await agent.generate(`Ideia do post: ${idea}`, {
    structuredOutput: { schema: generatedPostSchema }
  })

  const { rows } = await pool.query<Post>(
    `INSERT INTO posts (id, title, content)
     VALUES ($1, $2, $3)
     RETURNING ${POST_COLUMNS}`,
    [nanoid(), object.title, object.content]
  )

  return rows[0]
}
