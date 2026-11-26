import { isUniqueViolation } from "../db/errors.ts"
import type { PostReview } from "../domain/post-reviews.ts"
import { DEFAULT_PAGE_LIMIT, type Post, type PostFilters } from "../domain/posts.ts"
import { mastra } from "../mastra/index.ts"
import { POST_DRAFTING_WORKFLOW_ID } from "../mastra/workflows/post-drafting.ts"
import { insertPostWithReviews } from "../repositories/post-reviews.ts"
import {
  approvePostById,
  findPostById,
  findPosts,
  findPublishedPostBySlug,
  findTakenSlugs,
  rejectPostById,
  updateDraftById
} from "../repositories/posts.ts"
import { findAllTagNames } from "../repositories/tags.ts"
import { readingTimeMinutes } from "../utils/reading-time.ts"
import { slugify } from "../utils/slugify.ts"
import { toUniqueTags } from "./tags.ts"

const MAX_SLUG_LENGTH = 80
// Inserts simultâneos podem escolher o mesmo slug; o UNIQUE barra e tentamos de novo
const SLUG_ATTEMPTS = 3

export type ListPostsOptions = PostFilters & {
  includeAll?: boolean
  // Começa em 1
  page?: number
  limit?: number
}

export type PaginationMeta = {
  page: number
  limit: number
  total: number
}

export type PaginatedPosts = {
  data: Post[]
  meta: PaginationMeta
}

export async function listPosts({
  includeAll = false,
  tag,
  q,
  page = 1,
  limit = DEFAULT_PAGE_LIMIT
}: ListPostsOptions = {}): Promise<PaginatedPosts> {
  const { posts, total } = await findPosts(
    { approvedOnly: !includeAll, tag, q },
    { limit, offset: (page - 1) * limit }
  )

  return { data: posts, meta: { page, limit, total } }
}

// summary e meta_description são opcionais na edição: ausentes, mantêm o valor atual
export type PostContent = Pick<Post, "title" | "content"> &
  Partial<Pick<Post, "summary" | "meta_description">>

// O rascunho recém-criado com a última revisão da IA (null se o revisor falhou)
export type PostDraft = Post & { review: PostReview | null }

export type UpdatePostDraftResult =
  | { status: "updated"; post: Post }
  | { status: "not_found" }
  | { status: "approved" }

function slugBase(title: string): string {
  return slugify(title).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "") || "post"
}

// Primeiro slug livre: a base, ou "base-N" com N uma unidade acima do maior sufixo em uso
export async function generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugBase(title)
  const taken = await findTakenSlugs(base, excludeId)

  if (!taken.includes(base)) return base

  const suffixes = taken.map((slug) => Number(slug.slice(base.length + 1)) || 1)
  return `${base}-${Math.max(1, ...suffixes) + 1}`
}

// Gera o slug e persiste; em colisão (corrida entre inserts) gera de novo e repete
async function withUniqueSlug<T>(
  title: string,
  excludeId: string | undefined,
  persist: (slug: string) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const slug = await generateUniqueSlug(title, excludeId)

    try {
      return await persist(slug)
    } catch (error) {
      if (!isUniqueViolation(error, "posts_slug_key") || attempt >= SLUG_ATTEMPTS) throw error
    }
  }
}

export async function getPost(id: string): Promise<Post | null> {
  return findPostById(id)
}

export async function getPublishedPostBySlug(slug: string): Promise<Post | null> {
  return findPublishedPostBySlug(slug)
}

// Roda o workflow escrever → revisar → (reescrever) → SEO e grava o rascunho com as
// revisões e as tags sugeridas. Sem SEO (o agente falhou), o slug vem do título e não há tags.
export async function createPostDraft(idea: string): Promise<PostDraft> {
  const existingTags = await findAllTagNames()
  const run = await mastra.getWorkflow(POST_DRAFTING_WORKFLOW_ID).createRun()
  const result = await run.start({ inputData: { idea, existingTags } })

  if (result.status !== "success") {
    throw new Error(`Workflow ${POST_DRAFTING_WORKFLOW_ID} terminou com status ${result.status}`, {
      cause: result.status === "failed" ? result.error : undefined
    })
  }

  const { title, content, reviews, seo } = result.result
  const newPost = {
    title,
    content,
    reading_time_minutes: readingTimeMinutes(content),
    summary: seo?.summary ?? null,
    meta_description: seo?.meta_description ?? null
  }
  const tags = toUniqueTags(seo?.tags ?? [])

  // O slug da IA passa pelo mesmo slugify e pela checagem de colisão que o título passaria
  const saved = await withUniqueSlug(seo?.slug || title, undefined, (slug) =>
    insertPostWithReviews({ ...newPost, slug }, reviews, tags)
  )

  return { ...saved.post, review: saved.reviews.at(-1) ?? null }
}

// Só posts não aprovados são editáveis. Como ainda não têm URL pública,
// o slug é regerado quando o título muda.
export async function updatePostDraft(
  id: string,
  { title, content, summary, meta_description }: PostContent
): Promise<UpdatePostDraftResult> {
  const current = await findPostById(id)

  if (!current) return { status: "not_found" }
  if (current.approved_at !== null) return { status: "approved" }

  const reading_time_minutes = readingTimeMinutes(content)
  const changes = {
    title,
    content,
    reading_time_minutes,
    summary: summary === undefined ? current.summary : summary,
    meta_description: meta_description === undefined ? current.meta_description : meta_description
  }

  const post =
    title === current.title
      ? await updateDraftById(id, { ...changes, slug: current.slug })
      : await withUniqueSlug(title, id, (slug) => updateDraftById(id, { ...changes, slug }))

  // null aqui significa que o post foi aprovado (ou removido) entre a leitura e o update
  if (!post) return (await findPostById(id)) ? { status: "approved" } : { status: "not_found" }

  return { status: "updated", post }
}

export async function approvePost(id: string): Promise<Post | null> {
  return approvePostById(id)
}

export async function rejectPost(id: string): Promise<Post | null> {
  return rejectPostById(id)
}
