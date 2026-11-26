import { nanoid } from "nanoid"

import { pool, withTransaction, type Queryable } from "../db/index.ts"
import type { NewPostReview, PostReview } from "../domain/post-reviews.ts"
import type { NewPost, Post, PostTag } from "../domain/posts.ts"
import { findPostById, insertPost } from "./posts.ts"
import { replacePostTags } from "./tags.ts"

export type { NewPostReview, PostReview } from "../domain/post-reviews.ts"

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

// O rascunho, as revisões que ele recebeu e as tags sugeridas entram juntos ou nenhum entra.
// Erros (ex.: colisão no UNIQUE do slug) desfazem a transação e são relançados.
// As tags precisam chegar sem slugs repetidos (ver replacePostTags).
export async function insertPostWithReviews(
  newPost: NewPost,
  reviews: NewPostReview[],
  tags: PostTag[] = []
): Promise<{ post: Post; reviews: PostReview[] }> {
  return withTransaction(async (client) => {
    const inserted = await insertPost(newPost, client)
    const savedReviews = await insertPostReviews(client, inserted.id, reviews)

    if (tags.length === 0) return { post: inserted, reviews: savedReviews }

    // O RETURNING do insert veio antes das tags: relê o post para devolvê-lo com elas
    await replacePostTags(inserted.id, tags, client)
    const post = (await findPostById(inserted.id, client)) ?? inserted

    return { post, reviews: savedReviews }
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
