import { z } from "zod"

import type { App, Request } from "../http/app.ts"
import { createRateLimiter, type RateLimitOptions } from "../http/rate-limit.ts"
import { sendValidationError } from "../http/validation.ts"
import { likePost, listPopularPosts, unlikePost } from "../services/likes.ts"

// Gerado pelo cliente (ex.: um nanoid guardado no navegador); identifica o visitante sem login
const visitorHeaderSchema = z.object({
  "x-visitor-id": z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "Must be 8-64 characters: letters, digits, '_' or '-'")
})

const popularPostsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(10)
})

function parseVisitorId(req: Request) {
  return visitorHeaderSchema.safeParse({ "x-visitor-id": req.headers["x-visitor-id"] })
}

// Padrão: 30 curtidas/descurtidas por minuto por IP (POST e DELETE dividem a cota)
const DEFAULT_LIKES_RATE_LIMIT: RateLimitOptions = { max: 30, windowMs: 60_000 }

export type LikeRoutesOptions = { rateLimit?: RateLimitOptions }

export function registerLikeRoutes(app: App, options: LikeRoutesOptions = {}) {
  const limiter = createRateLimiter(options.rateLimit ?? DEFAULT_LIKES_RATE_LIMIT)

  app.post("/posts/:id/likes", async (req, res) => {
    if (!limiter.check(req, res)) return

    const visitor = parseVisitorId(req)
    if (!visitor.success) return sendValidationError(res, visitor.error, "Invalid headers")

    try {
      const result = await likePost(req.params.id, visitor.data["x-visitor-id"])

      if (!result) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.status(result.created ? 201 : 200).send({
        message: result.created ? "Post liked" : "Post already liked",
        data: { post_id: req.params.id, liked: true, likes_count: result.likes_count }
      })
    } catch (error) {
      console.error("Falha ao curtir o post:", error)
      return res.status(500).send({ message: "Failed to like post" })
    }
  })

  app.delete("/posts/:id/likes", async (req, res) => {
    if (!limiter.check(req, res)) return

    const visitor = parseVisitorId(req)
    if (!visitor.success) return sendValidationError(res, visitor.error, "Invalid headers")

    try {
      const result = await unlikePost(req.params.id, visitor.data["x-visitor-id"])

      if (!result) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({
        message: "Like removed",
        data: { post_id: req.params.id, liked: false, likes_count: result.likes_count }
      })
    } catch (error) {
      console.error("Falha ao descurtir o post:", error)
      return res.status(500).send({ message: "Failed to remove like" })
    }
  })

  app.get("/posts/popular", async (req, res) => {
    const query = popularPostsQuerySchema.safeParse({
      days: req.query.get("days") ?? undefined,
      limit: req.query.get("limit") ?? undefined
    })
    if (!query.success) return sendValidationError(res, query.error, "Invalid query parameters")

    try {
      const posts = await listPopularPosts(query.data)
      return res.send({ data: posts })
    } catch (error) {
      console.error("Falha ao listar os posts populares:", error)
      return res.status(500).send({ message: "Failed to list popular posts" })
    }
  })
}
