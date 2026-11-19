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

export async function findPostById(id: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1`, [id])

  return rows[0] ?? null
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

export async function approvePostById(id: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `UPDATE posts
     SET approved_at = now(), published_at = now(), rejected_at = NULL
     WHERE id = $1
     RETURNING ${POST_COLUMNS}`,
    [id]
  )

  return rows[0] ?? null
}

export async function rejectPostById(id: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `UPDATE posts
     SET rejected_at = now(), approved_at = NULL
     WHERE id = $1
     RETURNING ${POST_COLUMNS}`,
    [id]
  )

  return rows[0] ?? null
}
