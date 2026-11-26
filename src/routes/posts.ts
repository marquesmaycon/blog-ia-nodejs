import { z } from "zod"

import type { App } from "../http/app.ts"
import { requireApiKey } from "../http/auth.ts"
import { sendValidationError } from "../http/validation.ts"
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

const createPostDraftBodySchema = z.object({
  idea: z.string().trim().min(1)
})

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const updatePostBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1)
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
  app.get("/posts", async (req, res) => {
    const include = req.query.get("include")

    if (include !== null && include !== "all") {
      return res.status(400).send({ message: "Invalid value for 'include'" })
    }

    const query = listPostsQuerySchema.safeParse({
      tag: req.query.get("tag") ?? undefined,
      page: req.query.get("page") ?? undefined,
      limit: req.query.get("limit") ?? undefined,
      q: req.query.get("q") ?? undefined
    })
    if (!query.success) return sendValidationError(res, query.error, "Invalid query parameters")

    const includeAll = include === "all"

    if (includeAll && !requireApiKey(req, res)) return

    try {
      return res.send(await listPosts({ includeAll, ...query.data }))
    } catch (error) {
      console.error("Falha ao listar os posts:", error)
      return res.status(500).send({ message: "Failed to list posts" })
    }
  })

  app.get("/posts/:id", async (req, res) => {
    try {
      const post = await getPost(req.params.id)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ data: post })
    } catch (error) {
      console.error("Falha ao buscar o post:", error)
      return res.status(500).send({ message: "Failed to get post" })
    }
  })

  // Rota pública de leitura: só posts publicados
  app.get("/posts/slug/:slug", async (req, res) => {
    const slug = postSlugSchema.safeParse(req.params.slug)
    if (!slug.success) return sendValidationError(res, slug.error, "Invalid slug")

    try {
      const post = await getPublishedPostBySlug(slug.data)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ data: post })
    } catch (error) {
      console.error("Falha ao buscar o post pelo slug:", error)
      return res.status(500).send({ message: "Failed to get post" })
    }
  })

  // Dado editorial: as notas e críticas do revisor IA, para o admin decidir a aprovação
  app.get("/posts/:id/review", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const reviews = await getPostReviews(req.params.id)

      if (!reviews) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ data: reviews })
    } catch (error) {
      console.error("Falha ao buscar as revisões do post:", error)
      return res.status(500).send({ message: "Failed to get post review" })
    }
  })

  app.put("/posts/:id", async (req, res) => {
    if (!requireApiKey(req, res)) return

    const parsed = updatePostBodySchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, "Invalid request body")

    try {
      const result = await updatePostDraft(req.params.id, parsed.data)

      if (result.status === "not_found") {
        return res.status(404).send({ message: "Post not found" })
      }

      if (result.status === "approved") {
        return res.status(409).send({ message: "Approved posts cannot be edited" })
      }

      return res.send({ message: "Post updated", data: result.post })
    } catch (error) {
      console.error("Falha ao editar o post:", error)
      return res.status(500).send({ message: "Failed to update post" })
    }
  })

  app.patch("/posts/:id/approve", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const post = await approvePost(req.params.id)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ message: "Post approved", data: post })
    } catch (error) {
      console.error("Falha ao aprovar o post:", error)
      return res.status(500).send({ message: "Failed to approve post" })
    }
  })

  app.delete("/posts/:id/reject", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const post = await rejectPost(req.params.id)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ message: "Post rejected", data: post })
    } catch (error) {
      console.error("Falha ao reprovar o post:", error)
      return res.status(500).send({ message: "Failed to reject post" })
    }
  })

  app.post("/posts/draft", async (req, res) => {
    // Auth antes da validação: anônimo recebe 403 e nunca chega ao LLM
    if (!requireApiKey(req, res)) return

    const parsed = createPostDraftBodySchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, "Invalid request body")

    try {
      const post = await createPostDraft(parsed.data.idea)
      return res.status(201).send({ message: "Post draft created", data: post })
    } catch (error) {
      console.error("Falha ao gerar o post:", error)
      return res.status(502).send({ message: "Failed to generate post" })
    }
  })
}
