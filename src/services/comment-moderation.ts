import { z } from "zod"

import type { Comment } from "../domain/comments.ts"
import type { Post } from "../domain/posts.ts"
import { COMMENT_MODERATOR_AGENT_ID } from "../mastra/agents/comment-moderator.ts"
import { mastra } from "../mastra/index.ts"

export const MODERATION_CATEGORIES = [
  "spam",
  "toxic",
  "off-topic",
  "harassment",
  "self-promotion",
  "other"
] as const

const moderationSchema = z.object({
  verdict: z
    .enum(["approve", "reject", "review"])
    .describe("approve publica, reject reprova, review deixa para um humano"),
  reason: z.string().describe("Motivo do veredito, numa frase curta"),
  categories: z
    .array(z.enum(MODERATION_CATEGORIES))
    .describe("Problemas encontrados; vazio quando approve")
})

// Só o começo do post: basta para o contexto e limita os tokens gastos por comentário
const POST_EXCERPT_LENGTH = 1500
const DEFAULT_TIMEOUT_MS = 10_000

export type ModerationResult = Pick<
  Comment,
  "status" | "moderation_reason" | "moderation_categories"
>

export type CommentToModerate = Pick<Comment, "author_name" | "content">

// Na dúvida ou na falha, o comentário espera um humano: a IA nunca aprova por omissão
const PENDING: ModerationResult = {
  status: "pending",
  moderation_reason: null,
  moderation_categories: []
}

function timeoutMs(): number {
  const value = Number(process.env.COMMENT_MODERATION_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

function buildPrompt(post: Pick<Post, "title" | "content">, comment: CommentToModerate): string {
  return [
    `Título do post: ${post.title}`,
    `Trecho do post:\n${post.content.slice(0, POST_EXCERPT_LENGTH)}`,
    `Autor do comentário: ${comment.author_name}`,
    `<comentario>\n${comment.content}\n</comentario>`
  ].join("\n\n")
}

export async function moderateComment(
  post: Pick<Post, "title" | "content">,
  comment: CommentToModerate
): Promise<ModerationResult> {
  try {
    const agent = mastra.getAgent(COMMENT_MODERATOR_AGENT_ID)
    const { object } = await agent.generate(buildPrompt(post, comment), {
      structuredOutput: { schema: moderationSchema },
      abortSignal: AbortSignal.timeout(timeoutMs())
    })

    switch (object.verdict) {
      case "approve":
        return { status: "approved", moderation_reason: null, moderation_categories: [] }
      case "reject":
        return {
          status: "rejected",
          moderation_reason: object.reason,
          moderation_categories: object.categories
        }
      case "review":
        return {
          status: "pending",
          moderation_reason: object.reason,
          moderation_categories: object.categories
        }
    }
  } catch (error) {
    console.error("Falha na moderação do comentário; ficará pendente:", error)
    return PENDING
  }
}
