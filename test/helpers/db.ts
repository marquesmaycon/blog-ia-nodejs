import { pool } from "../../src/db/index.ts"
import type { Comment } from "../../src/repositories/comments.ts"
import type { Post } from "../../src/repositories/posts.ts"

export { pool }

// CASCADE limpa junto as tabelas que referenciam posts (ex.: comments)
export async function truncatePosts() {
  await pool.query("TRUNCATE posts CASCADE")
}

// Insere direto no banco, para montar cenários sem depender do código testado
export async function seedPost(overrides: Partial<Post> = {}): Promise<Post> {
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
     RETURNING id, title, content, published_at, approved_at, rejected_at`,
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
