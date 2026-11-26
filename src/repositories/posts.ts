import { nanoid } from "nanoid"

import { pool, type Queryable } from "../db/index.ts"

export type PostTag = {
  name: string
  slug: string
}

export type Post = {
  id: string
  // Único; gerado do título e usado na URL pública (GET /posts/slug/:slug)
  slug: string
  title: string
  content: string
  reading_time_minutes: number
  published_at: string
  approved_at: string | null
  rejected_at: string | null
  likes_count: number
  // Só comentários aprovados entram na contagem
  comments_count: number
  // Ordenadas pelo nome; lista vazia quando o post não tem tags
  tags: PostTag[]
}

export type PostFilters = {
  // Slug da tag; sem ela, não filtra
  tag?: string
  // Texto livre da busca full-text; sem ele, não filtra e ordena só por data
  q?: string
}

export type FindPostsFilters = PostFilters & {
  approvedOnly: boolean
}

export type Pagination = {
  limit: number
  offset: number
}

export type PostsPage = {
  posts: Post[]
  // Total de posts que batem com os filtros, ignorando a paginação
  total: number
}

export type NewPost = Pick<Post, "title" | "content" | "slug" | "reading_time_minutes">

export type DraftChanges = NewPost

export type PopularPost = Post & {
  // Curtidas recebidas dentro da janela consultada
  recent_likes: number
}

// Colunas qualificadas para não colidir em JOINs. As subqueries correlacionadas também
// funcionam no RETURNING; o ::int evita que o pg devolva o COUNT (bigint) como string.
export const POST_COLUMNS = `posts.id, posts.slug, posts.title, posts.content,
  posts.reading_time_minutes, posts.published_at,
  posts.approved_at, posts.rejected_at,
  (SELECT COUNT(*)::int FROM post_likes WHERE post_likes.post_id = posts.id) AS likes_count,
  (SELECT COUNT(*)::int FROM comments
    WHERE comments.post_id = posts.id AND comments.status = 'approved') AS comments_count,
  COALESCE(
    (SELECT json_agg(json_build_object('name', tags.name, 'slug', tags.slug) ORDER BY tags.name)
     FROM post_tags JOIN tags ON tags.id = post_tags.tag_id
     WHERE post_tags.post_id = posts.id),
    '[]'::json
  ) AS tags`

// $1 é o slug da tag; NULL desliga o filtro
const TAG_FILTER = `($1::text IS NULL OR EXISTS (
  SELECT 1 FROM post_tags JOIN tags ON tags.id = post_tags.tag_id
  WHERE post_tags.post_id = posts.id AND tags.slug = $1
))`

// $2 é o texto da busca; NULL desliga o filtro. O websearch_to_tsquery aceita a sintaxe
// de buscador (aspas, -termo, or) e nunca falha com entrada malformada.
const SEARCH_QUERY = `websearch_to_tsquery('portuguese', $2)`
const SEARCH_FILTER = `($2::text IS NULL OR posts.search @@ ${SEARCH_QUERY})`

// Com busca, os mais relevantes primeiro; o id desempata para a paginação ser estável
const ORDER_BY = `CASE WHEN $2::text IS NULL THEN 0 ELSE ts_rank(posts.search, ${SEARCH_QUERY}) END DESC,
  posts.published_at DESC, posts.id DESC`

export async function findPosts(
  { approvedOnly, tag, q }: FindPostsFilters,
  { limit, offset }: Pagination
): Promise<PostsPage> {
  // Fragmento constante (sem input do usuário), seguro para interpolar
  const where = `${approvedOnly ? "posts.approved_at IS NOT NULL AND " : ""}${TAG_FILTER} AND ${SEARCH_FILTER}`
  const filterParams = [tag ?? null, q ?? null]

  // Duas queries em vez de COUNT(*) OVER(): o total continua certo numa página além do fim
  const [page, count] = await Promise.all([
    pool.query<Post>(
      `SELECT ${POST_COLUMNS} FROM posts WHERE ${where} ORDER BY ${ORDER_BY} LIMIT $3 OFFSET $4`,
      [...filterParams, limit, offset]
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM posts WHERE ${where}`,
      filterParams
    )
  ])

  return { posts: page.rows, total: count.rows[0].total }
}

export async function findPostById(id: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1`, [id])

  return rows[0] ?? null
}

// Só posts publicados: rascunhos e reprovados não têm URL pública
export async function findPublishedPostBySlug(slug: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts WHERE slug = $1 AND approved_at IS NOT NULL`,
    [slug]
  )

  return rows[0] ?? null
}

// Slugs já usados que colidem com `base`: ele mesmo e as variações "base-N".
// `excludeId` ignora o próprio post, para a edição não colidir consigo mesma.
export async function findTakenSlugs(base: string, excludeId?: string): Promise<string[]> {
  const { rows } = await pool.query<{ slug: string }>(
    `SELECT slug FROM posts
     WHERE (slug = $1 OR slug ~ ('^' || $2 || '-[0-9]+$'))
       AND ($3::text IS NULL OR id <> $3)`,
    [base, escapeRegex(base), excludeId ?? null]
  )

  return rows.map((row) => row.slug)
}

// `client` permite gravar dentro de uma transação (ex.: junto com os reviews do rascunho)
export async function insertPost(
  { title, content, slug, reading_time_minutes }: NewPost,
  client: Queryable = pool
): Promise<Post> {
  const { rows } = await client.query<Post>(
    `INSERT INTO posts (id, title, content, slug, reading_time_minutes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${POST_COLUMNS}`,
    [nanoid(), title, content, slug, reading_time_minutes]
  )

  return rows[0]
}

// Só altera posts não aprovados; null quando o post não existe ou já foi aprovado.
// A coluna search é gerada, então acompanha o novo título/conteúdo sozinha.
export async function updateDraftById(
  id: string,
  { title, content, slug, reading_time_minutes }: DraftChanges
): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `UPDATE posts
     SET title = $2, content = $3, slug = $4, reading_time_minutes = $5
     WHERE id = $1 AND approved_at IS NULL
     RETURNING ${POST_COLUMNS}`,
    [id, title, content, slug, reading_time_minutes]
  )

  return rows[0] ?? null
}

export async function approvePostById(id: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `UPDATE posts
     SET approved_at = now(), published_at = now(), rejected_at = NULL
     WHERE id = $1
     RETURNING ${POST_COLUMNS}`,
    [id]
  )

  return rows[0] ?? null
}

export async function rejectPostById(id: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `UPDATE posts
     SET rejected_at = now(), approved_at = NULL
     WHERE id = $1
     RETURNING ${POST_COLUMNS}`,
    [id]
  )

  return rows[0] ?? null
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Ranking de posts aprovados pelas curtidas recebidas nos últimos `days` dias.
// Posts sem curtidas na janela ficam de fora.
export async function findPopularPosts({
  days,
  limit
}: {
  days: number
  limit: number
}): Promise<PopularPost[]> {
  const { rows } = await pool.query<PopularPost>(
    `SELECT ${POST_COLUMNS}, COUNT(*)::int AS recent_likes
     FROM posts
     JOIN post_likes ON post_likes.post_id = posts.id
     WHERE posts.approved_at IS NOT NULL
       AND post_likes.created_at >= now() - make_interval(days => $1)
     GROUP BY posts.id
     ORDER BY recent_likes DESC, posts.published_at DESC
     LIMIT $2`,
    [days, limit]
  )

  return rows
}
