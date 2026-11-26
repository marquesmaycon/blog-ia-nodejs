import { pool } from "../../src/db/index.ts"
import { COMMENT_COLUMNS, type Comment } from "../../src/repositories/comments.ts"
import { POST_REVIEW_COLUMNS, type PostReview } from "../../src/repositories/post-reviews.ts"
import { POST_COLUMNS, type Post, type PostTag } from "../../src/repositories/posts.ts"
import { slugify } from "../../src/utils/slugify.ts"

export { pool }

// CASCADE limpa junto as tabelas que referenciam posts (comments, post_likes, post_tags,
// post_reviews).
// tags não referencia posts, então entra explicitamente.
export async function truncatePosts() {
  await pool.query("TRUNCATE posts, tags CASCADE")
}

// Insere direto no banco, para montar cenários sem depender do código testado
// Contadores e tags são derivados (subqueries), por isso ficam fora dos overrides
export async function seedPost(
  overrides: Partial<Omit<Post, "likes_count" | "comments_count" | "tags">> = {}
): Promise<Post> {
  const id = `seed-${crypto.randomUUID()}`
  const post = {
    id,
    slug: id,
    title: "Post de teste",
    content: "# Conteúdo",
    summary: null,
    meta_description: null,
    reading_time_minutes: 1,
    published_at: new Date().toISOString(),
    approved_at: null,
    rejected_at: null,
    ...overrides
  }

  const { rows } = await pool.query<Post>(
    `INSERT INTO posts
       (id, slug, title, content, summary, meta_description, reading_time_minutes,
        published_at, approved_at, rejected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${POST_COLUMNS}`,
    [
      post.id,
      post.slug,
      post.title,
      post.content,
      post.summary,
      post.meta_description,
      post.reading_time_minutes,
      post.published_at,
      post.approved_at,
      post.rejected_at
    ]
  )

  return rows[0]
}

export async function seedComment(
  overrides: Partial<Comment> & Pick<Comment, "post_id">
): Promise<Comment> {
  const comment = {
    id: `seed-${crypto.randomUUID()}`,
    author_name: "Leitor",
    content: "Comentário de teste",
    status: "pending",
    moderation_reason: null,
    moderation_categories: [],
    parent_id: null,
    author_type: "reader",
    created_at: new Date().toISOString(),
    ...overrides
  }

  const { rows } = await pool.query<Comment>(
    `INSERT INTO comments
       (id, post_id, author_name, content, status, moderation_reason, moderation_categories,
        parent_id, author_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COMMENT_COLUMNS}`,
    [
      comment.id,
      comment.post_id,
      comment.author_name,
      comment.content,
      comment.status,
      comment.moderation_reason,
      comment.moderation_categories,
      comment.parent_id,
      comment.author_type,
      comment.created_at
    ]
  )

  return rows[0]
}

export async function seedLike({
  post_id,
  visitor_id = `visitor-${crypto.randomUUID()}`,
  created_at = new Date().toISOString()
}: {
  post_id: string
  visitor_id?: string
  created_at?: string
}) {
  await pool.query("INSERT INTO post_likes (post_id, visitor_id, created_at) VALUES ($1, $2, $3)", [
    post_id,
    visitor_id,
    created_at
  ])
}

export async function seedTag({
  name = `Tag ${crypto.randomUUID()}`,
  slug = slugify(name)
}: { name?: string; slug?: string } = {}): Promise<PostTag & { id: string }> {
  const { rows } = await pool.query<PostTag & { id: string }>(
    "INSERT INTO tags (id, name, slug) VALUES ($1, $2, $3) RETURNING id, name, slug",
    [`seed-${crypto.randomUUID()}`, name, slug]
  )

  return rows[0]
}

export async function seedPostTag({ post_id, tag_id }: { post_id: string; tag_id: string }) {
  await pool.query("INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)", [post_id, tag_id])
}

export async function seedPostReview(
  overrides: Partial<PostReview> & Pick<PostReview, "post_id">
): Promise<PostReview> {
  const review = {
    id: `seed-${crypto.randomUUID()}`,
    attempt: 1,
    score: 8,
    issues: [],
    suggestions: [],
    created_at: new Date().toISOString(),
    ...overrides
  }

  const { rows } = await pool.query<PostReview>(
    `INSERT INTO post_reviews (id, post_id, attempt, score, issues, suggestions, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${POST_REVIEW_COLUMNS}`,
    [
      review.id,
      review.post_id,
      review.attempt,
      review.score,
      review.issues,
      review.suggestions,
      review.created_at
    ]
  )

  return rows[0]
}
