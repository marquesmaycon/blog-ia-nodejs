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
  // Gerados pelo agente post-seo; null nos posts antigos e quando o agente falha
  summary: string | null
  meta_description: string | null
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

export type Pagination = {
  limit: number
  offset: number
}

export type PostsPage = {
  posts: Post[]
  // Total de posts que batem com os filtros, ignorando a paginação
  total: number
}

export type NewPost = Pick<
  Post,
  "title" | "content" | "slug" | "reading_time_minutes" | "summary" | "meta_description"
>

export type DraftChanges = NewPost

export type PopularPost = Post & {
  // Curtidas recebidas dentro da janela consultada
  recent_likes: number
}

// Paginação de GET /posts: a rota valida o limite e o service usa o padrão
export const DEFAULT_PAGE_LIMIT = 10
export const MAX_PAGE_LIMIT = 50
