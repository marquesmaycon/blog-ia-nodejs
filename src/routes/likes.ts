import { z } from "zod"

import type { App, Request } from "../http/app.ts"
import { createRateLimiter, type RateLimitOptions } from "../http/rate-limit.ts"
import { notFound } from "../http/errors.ts"
import { parseHeaders, parseQuery } from "../http/validation.ts"
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

function parseVisitorId(req: Request<unknown>): string {
  return parseHeaders(req, visitorHeaderSchema)["x-visitor-id"]
}

// Padrão: 30 curtidas/descurtidas por minuto por IP (POST e DELETE dividem a cota)
const DEFAULT_LIKES_RATE_LIMIT: RateLimitOptions = { max: 30, windowMs: 60_000 }

export type LikeRoutesOptions = { rateLimit?: RateLimitOptions }

export function registerLikeRoutes(app: App, options: LikeRoutesOptions = {}) {
  const limiter = createRateLimiter(options.rateLimit ?? DEFAULT_LIKES_RATE_LIMIT)

  app.post(
    "/posts/:id/likes",
    async (req, res) => {
      if (!limiter.check(req, res)) return
      const visitorId = parseVisitorId(req)

      const result = await likePost(req.params.id, visitorId)
      if (!result) throw notFound("Post not found")

      return res.status(result.created ? 201 : 200).send({
        message: result.created ? "Post liked" : "Post already liked",
        data: { post_id: req.params.id, liked: true, likes_count: result.likes_count }
      })
    },
    { onError: { message: "Failed to like post", log: "Falha ao curtir o post:" } }
  )

  app.delete(
    "/posts/:id/likes",
    async (req, res) => {
      if (!limiter.check(req, res)) return
      const visitorId = parseVisitorId(req)

      const result = await unlikePost(req.params.id, visitorId)
      if (!result) throw notFound("Post not found")

      return res.send({
        message: "Like removed",
        data: { post_id: req.params.id, liked: false, likes_count: result.likes_count }
      })
    },
    { onError: { message: "Failed to remove like", log: "Falha ao descurtir o post:" } }
  )

  app.get(
    "/posts/popular",
    async (req) => {
      const query = parseQuery(req, popularPostsQuerySchema)
      return { data: await listPopularPosts(query) }
    },
    {
      onError: {
        message: "Failed to list popular posts",
        log: "Falha ao listar os posts populares:"
      }
    }
  )
}
