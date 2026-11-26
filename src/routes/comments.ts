import type { CommentStatus } from "../domain/comments.ts"
import type { App } from "../http/app.ts"
import { assertApiKey } from "../http/auth.ts"
import { HttpError, notFound } from "../http/errors.ts"
import { createRateLimiter, type RateLimitOptions } from "../http/rate-limit.ts"
import { parseBody, parseQuery } from "../http/validation.ts"
import { draftCommentReply, type DraftReplyError } from "../services/comment-replies.ts"
import {
  approveComment,
  createComment,
  deleteComment,
  listCommentsByStatus,
  listPostComments
} from "../services/comments.ts"
import { createCommentBodySchema, listCommentsQuerySchema } from "./comments.schemas.ts"

// A mensagem do 201 conta ao leitor o que o moderador decidiu
const CREATED_MESSAGES: Record<CommentStatus, string> = {
  approved: "Comment published",
  rejected: "Comment rejected",
  pending: "Comment awaiting moderation"
}

// Como cada falha do rascunho de resposta aparece para o admin
const REPLY_ERRORS: Record<DraftReplyError, { status: number; message: string }> = {
  not_found: { status: 404, message: "Comment not found" },
  not_eligible: { status: 409, message: "Comment cannot be replied" },
  already_replied: { status: 409, message: "Reply already exists" },
  not_a_question: { status: 422, message: "Comment is not an answerable question" },
  not_answerable: { status: 422, message: "Comment is not an answerable question" },
  generation_failed: { status: 502, message: "Failed to generate reply" }
}

// Padrão: 5 comentários por minuto por IP
const DEFAULT_COMMENTS_RATE_LIMIT: RateLimitOptions = { max: 5, windowMs: 60_000 }

export type CommentRoutesOptions = { rateLimit?: RateLimitOptions }

export function registerCommentRoutes(app: App, options: CommentRoutesOptions = {}) {
  const limiter = createRateLimiter(options.rateLimit ?? DEFAULT_COMMENTS_RATE_LIMIT)

  app.get(
    "/posts/:id/comments",
    async (req) => {
      const comments = await listPostComments(req.params.id)
      if (!comments) throw notFound("Post not found")

      return { data: comments }
    },
    { onError: { message: "Failed to list comments", log: "Falha ao listar os comentários:" } }
  )

  app.post(
    "/posts/:id/comments",
    async (req, res) => {
      // Antes da validação: requisição inválida também consome a cota.
      // É o limitador que protege os tokens gastos pelo moderador IA.
      if (!limiter.check(req, res)) return
      const body = parseBody(req, createCommentBodySchema)

      const comment = await createComment(req.params.id, body)
      if (!comment) throw notFound("Post not found")

      return res.status(201).send({ message: CREATED_MESSAGES[comment.status], data: comment })
    },
    { onError: { message: "Failed to create comment", log: "Falha ao criar o comentário:" } }
  )

  app.get(
    "/comments",
    async (req) => {
      assertApiKey(req)
      const { status } = parseQuery(req, listCommentsQuerySchema)

      return { data: await listCommentsByStatus(status) }
    },
    {
      onError: {
        message: "Failed to list comments",
        log: "Falha ao listar os comentários por status:"
      }
    }
  )

  app.patch(
    "/comments/:id/approve",
    async (req) => {
      assertApiKey(req)

      const comment = await approveComment(req.params.id)
      if (!comment) throw notFound("Comment not found")

      return { message: "Comment approved", data: comment }
    },
    { onError: { message: "Failed to approve comment", log: "Falha ao aprovar o comentário:" } }
  )

  app.post(
    "/comments/:id/reply",
    async (req, res) => {
      assertApiKey(req)

      const result = await draftCommentReply(req.params.id)
      if (!result.ok) {
        const { status, message } = REPLY_ERRORS[result.error]
        throw new HttpError(status, message, result.reason ? { reason: result.reason } : undefined)
      }

      return res.status(201).send({ message: "Reply draft created", data: result.reply })
    },
    {
      onError: {
        message: "Failed to create reply",
        log: "Falha ao criar a resposta do comentário:"
      }
    }
  )

  app.delete(
    "/comments/:id",
    async (req) => {
      assertApiKey(req)

      const deleted = await deleteComment(req.params.id)
      if (!deleted) throw notFound("Comment not found")

      return { message: "Comment deleted" }
    },
    { onError: { message: "Failed to delete comment", log: "Falha ao apagar o comentário:" } }
  )
}
