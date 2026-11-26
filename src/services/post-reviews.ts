import type { PostReview } from "../domain/post-reviews.ts"
import { findPostReviews } from "../repositories/post-reviews.ts"
import { findPostById } from "../repositories/posts.ts"

export type PostReviewSummary = {
  // Última revisão (a que liberou ou encerrou o loop); null se o revisor nunca respondeu
  latest: PostReview | null
  history: PostReview[]
}

// null quando o post não existe
export async function getPostReviews(postId: string): Promise<PostReviewSummary | null> {
  const post = await findPostById(postId)
  if (!post) return null

  const history = await findPostReviews(postId)
  return { latest: history.at(-1) ?? null, history }
}
