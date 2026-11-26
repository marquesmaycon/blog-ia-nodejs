import type { PopularPost } from "../domain/posts.ts"
import { countLikesByPost, deleteLike, insertLike } from "../repositories/likes.ts"
import { findPopularPosts } from "../repositories/posts.ts"
import { isPublishedPost } from "./post-visibility.ts"

export type LikeResult = {
  // false quando o visitante já tinha curtido o post
  created: boolean
  likes_count: number
}

export type PopularPostsQuery = {
  days: number
  limit: number
}

// Retorna null quando o post não existe ou não está aprovado
export async function likePost(postId: string, visitorId: string): Promise<LikeResult | null> {
  if (!(await isPublishedPost(postId))) return null

  const created = await insertLike(postId, visitorId)
  return { created, likes_count: await countLikesByPost(postId) }
}

// Retorna null quando o post não existe ou não está aprovado.
// Idempotente: descurtir sem ter curtido não é erro.
export async function unlikePost(
  postId: string,
  visitorId: string
): Promise<{ likes_count: number } | null> {
  if (!(await isPublishedPost(postId))) return null

  await deleteLike(postId, visitorId)
  return { likes_count: await countLikesByPost(postId) }
}

export async function listPopularPosts(query: PopularPostsQuery): Promise<PopularPost[]> {
  return findPopularPosts(query)
}
