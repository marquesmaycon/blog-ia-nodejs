import {
  approveCommentById,
  deleteCommentById,
  findApprovedCommentsByPost,
  findCommentsByStatus,
  insertComment,
  type Comment,
  type CommentStatus
} from "../repositories/comments.ts"
import { isPublishedPost } from "./post-visibility.ts"

export type CommentInput = Pick<Comment, "author_name" | "content">

// Retorna null quando o post não existe ou não está aprovado
export async function listPostComments(postId: string): Promise<Comment[] | null> {
  if (!(await isPublishedPost(postId))) return null

  return findApprovedCommentsByPost(postId)
}

// Retorna null quando o post não existe ou não está aprovado.
// Todo comentário nasce 'pending' e aguarda moderação.
export async function createComment(
  postId: string,
  { author_name, content }: CommentInput
): Promise<Comment | null> {
  if (!(await isPublishedPost(postId))) return null

  return insertComment({ post_id: postId, author_name, content })
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
