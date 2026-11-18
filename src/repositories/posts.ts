import { nanoid } from "nanoid"

import { pool } from "../db/index.ts"

export type Post = {
  id: string
  title: string
  content: string
  published_at: string
  approved_at: string | null
  rejected_at: string | null
}

export type NewPost = Pick<Post, "title" | "content">

const POST_COLUMNS = "id, title, content, published_at, approved_at, rejected_at"

export async function findAllPosts(): Promise<Post[]> {
  const { rows } = await pool.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts ORDER BY published_at DESC`
  )

  return rows
}

export async function insertPost({ title, content }: NewPost): Promise<Post> {
  const { rows } = await pool.query<Post>(
    `INSERT INTO posts (id, title, content)
     VALUES ($1, $2, $3)
     RETURNING ${POST_COLUMNS}`,
    [nanoid(), title, content]
  )

  return rows[0]
}
