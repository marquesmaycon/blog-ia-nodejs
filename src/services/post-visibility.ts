import { findPostById } from "../repositories/posts.ts"

// Leitores só interagem com posts publicados: rascunhos e reprovados ficam invisíveis
export async function isPublishedPost(postId: string): Promise<boolean> {
  const post = await findPostById(postId)
  return post?.approved_at != null
}
