import { nanoid } from "nanoid"

import { getPool } from "../db/index.ts"
import type { Comment, CommentStatus, NewComment } from "../domain/comments.ts"

export const COMMENT_COLUMNS =
  "id, post_id, author_name, content, status, moderation_reason, moderation_categories, parent_id, author_type, created_at"

export async function findCommentById(id: string): Promise<Comment | null> {
  const { rows } = await getPool().query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = $1`,
    [id]
  )

  return rows[0] ?? null
}

// Já existe resposta da IA (em qualquer status) para o comentário?
export async function hasAiReply(parentId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM comments WHERE parent_id = $1 AND author_type = 'ai'
     ) AS exists`,
    [parentId]
  )

  return rows[0].exists
}

export async function findApprovedCommentsByPost(postId: string): Promise<Comment[]> {
  const { rows } = await getPool().query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments
     WHERE post_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [postId]
  )

  return rows
}

// Fila de moderação: do mais antigo para o mais recente
export async function findCommentsByStatus(status: CommentStatus): Promise<Comment[]> {
  const { rows } = await getPool().query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments WHERE status = $1 ORDER BY created_at ASC`,
    [status]
  )

  return rows
}

export async function insertComment({
  post_id,
  author_name,
  content,
  status = "pending",
  moderation_reason = null,
  moderation_categories = [],
  parent_id = null,
  author_type = "reader"
}: NewComment): Promise<Comment> {
  const { rows } = await getPool().query<Comment>(
    `INSERT INTO comments
       (id, post_id, author_name, content, status, moderation_reason, moderation_categories,
        parent_id, author_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COMMENT_COLUMNS}`,
    [
      nanoid(),
      post_id,
      author_name,
      content,
      status,
      moderation_reason,
      moderation_categories,
      parent_id,
      author_type
    ]
  )

  return rows[0]
}

export async function approveCommentById(id: string): Promise<Comment | null> {
  const { rows } = await getPool().query<Comment>(
    `UPDATE comments
     SET status = 'approved', moderation_reason = NULL, moderation_categories = '{}'
     WHERE id = $1
     RETURNING ${COMMENT_COLUMNS}`,
    [id]
  )

  return rows[0] ?? null
}

export async function deleteCommentById(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query("DELETE FROM comments WHERE id = $1", [id])

  return (rowCount ?? 0) > 0
}
