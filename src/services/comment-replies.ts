import { z } from "zod"

import { env } from "../config/env.ts"
import type { Comment } from "../domain/comments.ts"
import type { Post } from "../domain/posts.ts"
import { COMMENT_REPLIER_AGENT_ID } from "../mastra/agents/comment-replier.ts"
import { mastra } from "../mastra/index.ts"
import { findCommentById, hasAiReply, insertComment } from "../repositories/comments.ts"
import { truncate } from "../utils/truncate.ts"
import { findPublishedPost } from "./post-visibility.ts"

const replySchema = z.object({
  is_question: z.boolean().describe("O comentário é uma pergunta sobre o post?"),
  answerable: z.boolean().describe("O conteúdo do post responde a pergunta?"),
  reply: z.string().describe("Resposta ao leitor; vazia quando não responde"),
  reason: z.string().describe("Motivo da decisão, numa frase curta")
})

// A resposta usa só o post, então ele vai inteiro (com um teto para posts muito longos)
const POST_CONTENT_LENGTH = 8000
// Mesmo limite dos comentários de leitores (routes/comments.ts)
const REPLY_MAX_LENGTH = 2000

export const REPLY_AUTHOR_NAME = "Autor do blog (IA)"

export type CommentToReply = Pick<Comment, "author_name" | "content">

export type DraftReplyError =
  | "not_found"
  | "not_eligible"
  | "already_replied"
  | "not_a_question"
  | "not_answerable"
  | "generation_failed"

export type DraftReplyResult =
  | { ok: true; reply: Comment }
  | { ok: false; error: DraftReplyError; reason?: string }

function buildPrompt(post: Pick<Post, "title" | "content">, comment: CommentToReply): string {
  return [
    `Título do post: ${post.title}`,
    `Conteúdo do post:\n${post.content.slice(0, POST_CONTENT_LENGTH)}`,
    `Autor do comentário: ${comment.author_name}`,
    `<comentario>\n${comment.content}\n</comentario>`
  ].join("\n\n")
}

function isAiReplyConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "comments_ai_reply_per_parent_idx"
  )
}

// Só comentários de leitores, de primeiro nível e já aprovados recebem resposta
function isReplyable(comment: Comment): boolean {
  return (
    comment.status === "approved" && comment.author_type === "reader" && comment.parent_id === null
  )
}

// Pede ao agente uma resposta para o comentário e a grava como rascunho ('pending') da IA.
// Diferente da moderação, a falha da IA é devolvida: foi o admin quem pediu a resposta.
export async function draftCommentReply(commentId: string): Promise<DraftReplyResult> {
  const comment = await findCommentById(commentId)
  if (!comment) return { ok: false, error: "not_found" }
  if (!isReplyable(comment)) return { ok: false, error: "not_eligible" }

  const post = await findPublishedPost(comment.post_id)
  if (!post) return { ok: false, error: "not_eligible" }

  // Checa antes de chamar o LLM para não gastar tokens à toa; a unique index garante no insert
  if (await hasAiReply(comment.id)) return { ok: false, error: "already_replied" }

  let object: z.infer<typeof replySchema>
  try {
    const agent = mastra.getAgent(COMMENT_REPLIER_AGENT_ID)
    const result = await agent.generate(buildPrompt(post, comment), {
      structuredOutput: { schema: replySchema },
      abortSignal: AbortSignal.timeout(env().COMMENT_REPLY_TIMEOUT_MS)
    })
    object = replySchema.parse(result.object)
  } catch (error) {
    console.error("Falha ao gerar a resposta do comentário:", error)
    return { ok: false, error: "generation_failed" }
  }

  if (!object.is_question) return { ok: false, error: "not_a_question", reason: object.reason }

  const content = object.reply.trim()
  if (!object.answerable || !content) {
    return { ok: false, error: "not_answerable", reason: object.reason }
  }

  try {
    const reply = await insertComment({
      post_id: comment.post_id,
      parent_id: comment.id,
      author_type: "ai",
      author_name: REPLY_AUTHOR_NAME,
      content: truncate(content, REPLY_MAX_LENGTH),
      status: "pending"
    })
    return { ok: true, reply }
  } catch (error) {
    // Outra requisição gravou a resposta enquanto o agente gerava esta
    if (isAiReplyConflict(error)) return { ok: false, error: "already_replied" }
    throw error
  }
}
