import { nanoid } from "nanoid"

import { pool, withTransaction, type Queryable } from "../db/index.ts"
import type { PostTag } from "../domain/posts.ts"
import type { TagWithCount } from "../domain/tags.ts"

// Substitui o conjunto de tags do post, criando as tags que ainda não existem.
// Os slugs precisam chegar sem repetição: o ON CONFLICT DO UPDATE não pode tocar
// a mesma linha duas vezes no mesmo comando. Lista vazia remove todas as tags do post.
// Com `client`, roda na transação de quem chamou; sem ele, abre a própria.
export async function replacePostTags(
  postId: string,
  tags: PostTag[],
  client?: Queryable
): Promise<void> {
  if (!client) return withTransaction((own) => replacePostTags(postId, tags, own))

  await client.query("DELETE FROM post_tags WHERE post_id = $1", [postId])

  if (tags.length === 0) return

  // O UPDATE é um no-op: existe para o RETURNING devolver também as tags que já existiam.
  // Numa tag existente, o nome cadastrado primeiro é mantido.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO tags (id, name, slug)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [tags.map(() => nanoid()), tags.map((tag) => tag.name), tags.map((tag) => tag.slug)]
  )

  await client.query("INSERT INTO post_tags (post_id, tag_id) SELECT $1, unnest($2::text[])", [
    postId,
    rows.map((row) => row.id)
  ])
}

// Nomes de todas as tags, inclusive as que só estão em rascunhos. É o vocabulário que
// o agente de SEO recebe para reaproveitar em vez de criar sinônimos.
export async function findAllTagNames(): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM tags ORDER BY name ASC")

  return rows.map((row) => row.name)
}

// Tags sem posts aprovados (ex.: só em rascunhos) ficam de fora
export async function findTagsWithApprovedPosts(): Promise<TagWithCount[]> {
  const { rows } = await pool.query<TagWithCount>(
    `SELECT tags.name, tags.slug, COUNT(*)::int AS posts_count
     FROM tags
     JOIN post_tags ON post_tags.tag_id = tags.id
     JOIN posts ON posts.id = post_tags.post_id
     WHERE posts.approved_at IS NOT NULL
     GROUP BY tags.id
     ORDER BY posts_count DESC, tags.name ASC`
  )

  return rows
}

// O ON DELETE CASCADE remove a tag de todos os posts
export async function deleteTagBySlug(slug: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM tags WHERE slug = $1", [slug])

  return (rowCount ?? 0) > 0
}
