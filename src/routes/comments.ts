import { z } from "zod"

import type { App } from "../http/app.ts"
import { requireApiKey } from "../http/auth.ts"
import { createRateLimiter, type RateLimitOptions } from "../http/rate-limit.ts"
import { sendValidationError } from "../http/validation.ts"
import type { CommentStatus } from "../repositories/comments.ts"
import {
  approveComment,
  createComment,
  deleteComment,
  listCommentsByStatus,
  listPostComments
} from "../services/comments.ts"

const createCommentBodySchema = z.object({
  author_name: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1).max(2000)
})

// Import só de tipo: importar valores do repositório carregaria o pool do Postgres
const COMMENT_STATUSES = ["pending", "approved", "rejected"] as const satisfies CommentStatus[]

// Objeto (e não o enum solto) para o erro apontar o campo "status"
const listCommentsQuerySchema = z.object({
  status: z.enum(COMMENT_STATUSES).default("pending")
})

// A mensagem do 201 conta ao leitor o que o moderador decidiu
const CREATED_MESSAGES: Record<CommentStatus, string> = {
  approved: "Comment published",
  rejected: "Comment rejected",
  pending: "Comment awaiting moderation"
}

// Padrão: 5 comentários por minuto por IP
const DEFAULT_COMMENTS_RATE_LIMIT: RateLimitOptions = { max: 5, windowMs: 60_000 }

export type CommentRoutesOptions = { rateLimit?: RateLimitOptions }

export function registerCommentRoutes(app: App, options: CommentRoutesOptions = {}) {
  const limiter = createRateLimiter(options.rateLimit ?? DEFAULT_COMMENTS_RATE_LIMIT)

  app.get("/posts/:id/comments", async (req, res) => {
    try {
      const comments = await listPostComments(req.params.id)

      if (!comments) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ data: comments })
    } catch (error) {
      console.error("Falha ao listar os comentários:", error)
      return res.status(500).send({ message: "Failed to list comments" })
    }
  })

  app.post("/posts/:id/comments", async (req, res) => {
    // Antes da validação: requisição inválida também consome a cota.
    // É o limitador que protege os tokens gastos pelo moderador IA.
    if (!limiter.check(req, res)) return

    const parsed = createCommentBodySchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, "Invalid request body")

    try {
      const comment = await createComment(req.params.id, parsed.data)

      if (!comment) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.status(201).send({ message: CREATED_MESSAGES[comment.status], data: comment })
    } catch (error) {
      console.error("Falha ao criar o comentário:", error)
      return res.status(500).send({ message: "Failed to create comment" })
    }
  })

  app.get("/comments", async (req, res) => {
    if (!requireApiKey(req, res)) return

    const query = listCommentsQuerySchema.safeParse({
      status: req.query.get("status") ?? undefined
    })
    if (!query.success) return sendValidationError(res, query.error, "Invalid query parameters")

    try {
      const comments = await listCommentsByStatus(query.data.status)
      return res.send({ data: comments })
    } catch (error) {
      console.error("Falha ao listar os comentários por status:", error)
      return res.status(500).send({ message: "Failed to list comments" })
    }
  })

  app.patch("/comments/:id/approve", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const comment = await approveComment(req.params.id)

      if (!comment) {
        return res.status(404).send({ message: "Comment not found" })
      }

      return res.send({ message: "Comment approved", data: comment })
    } catch (error) {
      console.error("Falha ao aprovar o comentário:", error)
      return res.status(500).send({ message: "Failed to approve comment" })
    }
  })

  app.delete("/comments/:id", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const deleted = await deleteComment(req.params.id)

      if (!deleted) {
        return res.status(404).send({ message: "Comment not found" })
      }

      return res.send({ message: "Comment deleted" })
    } catch (error) {
      console.error("Falha ao apagar o comentário:", error)
      return res.status(500).send({ message: "Failed to delete comment" })
    }
  })
}
