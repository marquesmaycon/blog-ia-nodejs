import { nanoid } from "nanoid"

import { pool } from "../db/index.ts"

export type Post = {
  id: string
  title: string
  content: string
  published_at: string
  approved_at: string | null
  rejected_at: string | null
  likes_count: number
  // Só comentários aprovados entram na contagem
  comments_count: number
}

export type NewPost = Pick<Post, "title" | "content">

export type PopularPost = Post & {
  // Curtidas recebidas dentro da janela consultada
  recent_likes: number
}

// Colunas qualificadas para não colidir em JOINs. As subqueries correlacionadas também
// funcionam no RETURNING; o ::int evita que o pg devolva o COUNT (bigint) como string.
export const POST_COLUMNS = `posts.id, posts.title, posts.content, posts.published_at,
  posts.approved_at, posts.rejected_at,
  (SELECT COUNT(*)::int FROM post_likes WHERE post_likes.post_id = posts.id) AS likes_count,
  (SELECT COUNT(*)::int FROM comments
    WHERE comments.post_id = posts.id AND comments.status = 'approved') AS comments_count`

export async function findAllPosts(): Promise<Post[]> {
  const { rows } = await pool.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts ORDER BY published_at DESC`
  )

  return rows
}

export async function findApprovedPosts(): Promise<Post[]> {
  const { rows } = await pool.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts WHERE approved_at IS NOT NULL ORDER BY published_at DESC`
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

// Ranking de posts aprovados pelas curtidas recebidas nos últimos `days` dias.
// Posts sem curtidas na janela ficam de fora.
export async function findPopularPosts({
  days,
  limit
}: {
  days: number
  limit: number
}): Promise<PopularPost[]> {
  const { rows } = await pool.query<PopularPost>(
    `SELECT ${POST_COLUMNS}, COUNT(*)::int AS recent_likes
     FROM posts
     JOIN post_likes ON post_likes.post_id = posts.id
     WHERE posts.approved_at IS NOT NULL
       AND post_likes.created_at >= now() - make_interval(days => $1)
     GROUP BY posts.id
     ORDER BY recent_likes DESC, posts.published_at DESC
     LIMIT $2`,
    [days, limit]
  )

  return rows
}
