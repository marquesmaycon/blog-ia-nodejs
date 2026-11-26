import type { Post } from "../domain/posts.ts"
import { findPostById } from "../repositories/posts.ts"

// Leitores só interagem com posts publicados: rascunhos e reprovados ficam invisíveis
export async function findPublishedPost(postId: string): Promise<Post | null> {
  const post = await findPostById(postId)
  return post?.approved_at != null ? post : null
}

export async function isPublishedPost(postId: string): Promise<boolean> {
  return (await findPublishedPost(postId)) !== null
}
