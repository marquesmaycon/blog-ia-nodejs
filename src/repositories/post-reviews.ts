import { nanoid } from "nanoid"

import { pool, withTransaction, type Queryable } from "../db/index.ts"
import { insertPost, type NewPost, type Post } from "./posts.ts"

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

export const POST_REVIEW_COLUMNS = "id, post_id, attempt, score, issues, suggestions, created_at"

// Recebe o client para gravar na mesma transação do post. Cada review vira uma linha;
// issues/suggestions vão como JSON porque o unnest achataria arrays de arrays.
export async function insertPostReviews(
  client: Queryable,
  postId: string,
  reviews: NewPostReview[]
): Promise<PostReview[]> {
  if (reviews.length === 0) return []

  const { rows } = await client.query<PostReview>(
    `INSERT INTO post_reviews (id, post_id, attempt, score, issues, suggestions)
     SELECT review.id, $1, review.attempt, review.score,
       ARRAY(SELECT json_array_elements_text(review.issues)),
       ARRAY(SELECT json_array_elements_text(review.suggestions))
     FROM json_to_recordset($2::json)
       AS review(id text, attempt int, score int, issues json, suggestions json)
     RETURNING ${POST_REVIEW_COLUMNS}`,
    [postId, JSON.stringify(reviews.map((review) => ({ id: nanoid(), ...review })))]
  )

  // RETURNING não garante a ordem das linhas inseridas
  return rows.toSorted((a, b) => a.attempt - b.attempt)
}

// O rascunho e as revisões que ele recebeu entram juntos ou nenhum entra.
// Erros (ex.: colisão no UNIQUE do slug) desfazem a transação e são relançados.
export async function insertPostWithReviews(
  newPost: NewPost,
  reviews: NewPostReview[]
): Promise<{ post: Post; reviews: PostReview[] }> {
  return withTransaction(async (client) => {
    const post = await insertPost(newPost, client)
    return { post, reviews: await insertPostReviews(client, post.id, reviews) }
  })
}

// Histórico de revisões do post, da primeira tentativa para a última
export async function findPostReviews(postId: string): Promise<PostReview[]> {
  const { rows } = await pool.query<PostReview>(
    `SELECT ${POST_REVIEW_COLUMNS} FROM post_reviews WHERE post_id = $1 ORDER BY attempt ASC`,
    [postId]
  )

  return rows
}
