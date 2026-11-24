import { pool } from "../db/index.ts"

// A PK (post_id, visitor_id) garante uma curtida por visitante.
// Retorna true quando a curtida é nova e false quando o visitante já tinha curtido.
export async function insertLike(postId: string, visitorId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO post_likes (post_id, visitor_id)
     VALUES ($1, $2)
     ON CONFLICT (post_id, visitor_id) DO NOTHING`,
    [postId, visitorId]
  )

  return (rowCount ?? 0) > 0
}

// Retorna true quando havia uma curtida para remover
export async function deleteLike(postId: string, visitorId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM post_likes WHERE post_id = $1 AND visitor_id = $2",
    [postId, visitorId]
  )

  return (rowCount ?? 0) > 0
}

export async function countLikesByPost(postId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = $1",
    [postId]
  )

  return rows[0].count
}
