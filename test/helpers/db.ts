import { pool } from "../../src/db/index.ts"
import type { Post } from "../../src/repositories/posts.ts"

export { pool }

export async function truncatePosts() {
  await pool.query("TRUNCATE posts")
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
