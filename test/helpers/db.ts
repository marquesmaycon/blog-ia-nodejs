import { pool } from "../../src/db/index.ts"
import type { Comment } from "../../src/repositories/comments.ts"
import { POST_COLUMNS, type Post } from "../../src/repositories/posts.ts"

export { pool }

// CASCADE limpa junto as tabelas que referenciam posts (ex.: comments)
export async function truncatePosts() {
  await pool.query("TRUNCATE posts CASCADE")
}

// Insere direto no banco, para montar cenários sem depender do código testado
// Contadores são derivados (subqueries), por isso ficam fora dos overrides
export async function seedPost(
  overrides: Partial<Omit<Post, "likes_count" | "comments_count">> = {}
): Promise<Post> {
  const post = {
    id: `seed-${crypto.randomUUID()}`,
    title: "Post de teste",
    content: "# Conteúdo",
    published_at: new Date().toISOString(),
    approved_at: null,
    rejected_at: null,
    ...overrides
  }

  const { rows } = await pool.query<Post>(
    `INSERT INTO posts (id, title, content, published_at, approved_at, rejected_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${POST_COLUMNS}`,
    [post.id, post.title, post.content, post.published_at, post.approved_at, post.rejected_at]
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
    created_at: new Date().toISOString(),
    ...overrides
  }

  const { rows } = await pool.query<Comment>(
    `INSERT INTO comments (id, post_id, author_name, content, status, moderation_reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, post_id, author_name, content, status, moderation_reason, created_at`,
    [
      comment.id,
      comment.post_id,
      comment.author_name,
      comment.content,
      comment.status,
      comment.moderation_reason,
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
