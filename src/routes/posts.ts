import { z } from "zod"

import type { App } from "../http/app.ts"
import { assertApiKey } from "../http/auth.ts"
import { badRequest, conflict, notFound } from "../http/errors.ts"
import { parseBody, parseQuery, parseValue } from "../http/validation.ts"
import { getPostReviews } from "../services/post-reviews.ts"
import {
  approvePost,
  createPostDraft,
  DEFAULT_PAGE_LIMIT,
  getPost,
  getPublishedPostBySlug,
  listPosts,
  MAX_PAGE_LIMIT,
  rejectPost,
  updatePostDraft
} from "../services/posts.ts"
import { META_DESCRIPTION_MAX_LENGTH, SUMMARY_MAX_LENGTH } from "../utils/seo.ts"

const createPostDraftBodySchema = z.object({
  idea: z.string().trim().min(1)
})

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Texto vazio (ou só espaços) limpa o campo, como enviar null; ausente mantém o atual
const optionalSeoText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => value || null)
    .nullable()
    .optional()

const updatePostBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1),
  summary: optionalSeoText(SUMMARY_MAX_LENGTH),
  meta_description: optionalSeoText(META_DESCRIPTION_MAX_LENGTH)
})

const postSlugSchema = z
  .string()
  .max(100)
  .regex(SLUG_PATTERN, "Must be a post slug (e.g. 'testes-com-node')")

// O filtro usa o slug (ex.: "node-js"), o mesmo que aparece em post.tags[].slug
const listPostsQuerySchema = z.object({
  tag: z.string().max(50).regex(SLUG_PATTERN, "Must be a tag slug (e.g. 'node-js')").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  // "q=" ou só espaços contam como busca ausente
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || undefined)
})

export function registerPostRoutes(app: App) {
  app.get(
    "/posts",
    async (req) => {
      // Fora do schema da query: o 400 tem mensagem própria e vem antes dos outros campos
      const include = req.query.get("include")
      if (include !== null && include !== "all") throw badRequest("Invalid value for 'include'")

      const { tag, page, limit, q } = parseQuery(req, listPostsQuerySchema)

      const includeAll = include === "all"
      if (includeAll) assertApiKey(req)

      return listPosts({ includeAll, tag, page, limit, q })
    },
    { onError: { message: "Failed to list posts", log: "Falha ao listar os posts:" } }
  )

  app.get(
    "/posts/:id",
    async (req) => {
      const post = await getPost(req.params.id)
      if (!post) throw notFound("Post not found")

      return { data: post }
    },
    { onError: { message: "Failed to get post", log: "Falha ao buscar o post:" } }
  )

  // Rota pública de leitura: só posts publicados
  app.get(
    "/posts/slug/:slug",
    async (req) => {
      const slug = parseValue(req.params.slug, postSlugSchema, "Invalid slug")

      const post = await getPublishedPostBySlug(slug)
      if (!post) throw notFound("Post not found")

      return { data: post }
    },
    { onError: { message: "Failed to get post", log: "Falha ao buscar o post pelo slug:" } }
  )

  // Dado editorial: as notas e críticas do revisor IA, para o admin decidir a aprovação
  app.get(
    "/posts/:id/review",
    async (req) => {
      assertApiKey(req)

      const reviews = await getPostReviews(req.params.id)
      if (!reviews) throw notFound("Post not found")

      return { data: reviews }
    },
    {
      onError: { message: "Failed to get post review", log: "Falha ao buscar as revisões do post:" }
    }
  )

  app.put(
    "/posts/:id",
    async (req) => {
      assertApiKey(req)
      const changes = parseBody(req, updatePostBodySchema)

      const result = await updatePostDraft(req.params.id, changes)
      if (result.status === "not_found") throw notFound("Post not found")
      if (result.status === "approved") throw conflict("Approved posts cannot be edited")

      return { message: "Post updated", data: result.post }
    },
    { onError: { message: "Failed to update post", log: "Falha ao editar o post:" } }
  )

  app.patch(
    "/posts/:id/approve",
    async (req) => {
      assertApiKey(req)

      const post = await approvePost(req.params.id)
      if (!post) throw notFound("Post not found")

      return { message: "Post approved", data: post }
    },
    { onError: { message: "Failed to approve post", log: "Falha ao aprovar o post:" } }
  )

  app.delete(
    "/posts/:id/reject",
    async (req) => {
      assertApiKey(req)

      const post = await rejectPost(req.params.id)
      if (!post) throw notFound("Post not found")

      return { message: "Post rejected", data: post }
    },
    { onError: { message: "Failed to reject post", log: "Falha ao reprovar o post:" } }
  )

  app.post(
    "/posts/draft",
    async (req, res) => {
      // Auth antes da validação: anônimo recebe 403 e nunca chega ao LLM
      assertApiKey(req)
      const { idea } = parseBody(req, createPostDraftBodySchema)

      const post = await createPostDraft(idea)
      return res.status(201).send({ message: "Post draft created", data: post })
    },
    // Qualquer falha na geração vira 502: o erro está no LLM, não na API
    { onError: { message: "Failed to generate post", log: "Falha ao gerar o post:", status: 502 } }
  )
}
