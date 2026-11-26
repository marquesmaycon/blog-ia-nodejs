import type { Comment, CommentStatus } from "../domain/comments.ts"
import {
  approveCommentById,
  deleteCommentById,
  findApprovedCommentsByPost,
  findCommentsByStatus,
  insertComment
} from "../repositories/comments.ts"
import { moderateComment } from "./comment-moderation.ts"
import { findPublishedPost, isPublishedPost } from "./post-visibility.ts"

export type CommentInput = Pick<Comment, "author_name" | "content">

// Retorna null quando o post não existe ou não está aprovado
export async function listPostComments(postId: string): Promise<Comment[] | null> {
  if (!(await isPublishedPost(postId))) return null

  return findApprovedCommentsByPost(postId)
}

// Retorna null quando o post não existe ou não está aprovado.
// O moderador IA decide o status inicial; se ele falhar, o comentário fica 'pending'.
export async function createComment(
  postId: string,
  { author_name, content }: CommentInput
): Promise<Comment | null> {
  const post = await findPublishedPost(postId)
  if (!post) return null

  const moderation = await moderateComment(post, { author_name, content })

  return insertComment({ post_id: postId, author_name, content, ...moderation })
}

export async function listCommentsByStatus(status: CommentStatus): Promise<Comment[]> {
  return findCommentsByStatus(status)
}

export async function approveComment(id: string): Promise<Comment | null> {
  return approveCommentById(id)
}

export async function deleteComment(id: string): Promise<boolean> {
  return deleteCommentById(id)
}
