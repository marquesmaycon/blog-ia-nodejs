import type { App } from "../http/app.ts"
import { assertApiKey } from "../http/auth.ts"
import { badRequest, conflict, notFound } from "../http/errors.ts"
import { parseBody, parseQuery, parseValue } from "../http/validation.ts"
import { getPostReviews } from "../services/post-reviews.ts"
import {
  approvePost,
  createPostDraft,
  getPost,
  getPublishedPostBySlug,
  listPosts,
  rejectPost,
  updatePostDraft
} from "../services/posts.ts"
import {
  createPostDraftBodySchema,
  listPostsQuerySchema,
  postSlugSchema,
  updatePostBodySchema
} from "./posts.schemas.ts"

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
