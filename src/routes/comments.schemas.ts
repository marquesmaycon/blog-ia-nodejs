// Schemas das rotas de comentários, também usados pela spec em src/docs/paths/comments.ts

import { z } from "zod"

import { COMMENT_STATUSES } from "../domain/comments.ts"

export const createCommentBodySchema = z.object({
  author_name: z.string().trim().min(1).max(80).meta({ example: "Ana" }),
  content: z.string().trim().min(1).max(2000).meta({ example: "Ótimo post, obrigado!" })
})

// Objeto (e não o enum solto) para o erro apontar o campo "status"
export const listCommentsQuerySchema = z.object({
  status: z.enum(COMMENT_STATUSES).default("pending")
})
