import { nanoid } from "nanoid"

import { pool } from "../db/index.ts"

// Espelha o CHECK da coluna comments.status (migration 002)
export type CommentStatus = "pending" | "approved" | "rejected"

export type Comment = {
  id: string
  post_id: string
  author_name: string
  content: string
  status: CommentStatus
  moderation_reason: string | null
  created_at: string
}

export type NewComment = Pick<Comment, "post_id" | "author_name" | "content">

const COMMENT_COLUMNS = "id, post_id, author_name, content, status, moderation_reason, created_at"

export async function findApprovedCommentsByPost(postId: string): Promise<Comment[]> {
  const { rows } = await pool.query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments
     WHERE post_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [postId]
  )

  return rows
}

// Fila de moderação: do mais antigo para o mais recente
export async function findCommentsByStatus(status: CommentStatus): Promise<Comment[]> {
  const { rows } = await pool.query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments WHERE status = $1 ORDER BY created_at ASC`,
    [status]
  )

  return rows
}

export async function insertComment({
  post_id,
  author_name,
  content
}: NewComment): Promise<Comment> {
  const { rows } = await pool.query<Comment>(
    `INSERT INTO comments (id, post_id, author_name, content)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COMMENT_COLUMNS}`,
    [nanoid(), post_id, author_name, content]
  )

  return rows[0]
}

export async function approveCommentById(id: string): Promise<Comment | null> {
  const { rows } = await pool.query<Comment>(
    `UPDATE comments
     SET status = 'approved', moderation_reason = NULL
     WHERE id = $1
     RETURNING ${COMMENT_COLUMNS}`,
    [id]
  )

  return rows[0] ?? null
}

export async function deleteCommentById(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM comments WHERE id = $1", [id])

  return (rowCount ?? 0) > 0
}
