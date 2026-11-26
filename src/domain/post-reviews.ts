export type PostReview = {
  id: string
  post_id: string
  // Tentativa avaliada: 1 é a primeira versão escrita, as seguintes são reescritas
  attempt: number
  // 0 a 10 (CHECK da migration 008)
  score: number
  issues: string[]
  suggestions: string[]
  created_at: string
}

export type NewPostReview = Pick<PostReview, "attempt" | "score" | "issues" | "suggestions">
