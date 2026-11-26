// Escreve o post e o submete ao revisor; abaixo da nota mínima, reescreve com o feedback.
// O workflow só gera: quem persiste o rascunho e os reviews é o service (createPostDraft).
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { POST_REVIEWER_AGENT_ID } from "../agents/post-reviewer.ts"
import { POST_WRITER_AGENT_ID } from "../agents/post-writer.ts"

export const POST_DRAFTING_WORKFLOW_ID = "post-drafting"

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_MIN_SCORE = 7
const DEFAULT_REVIEW_TIMEOUT_MS = 30_000

export const draftSchema = z.object({
  title: z.string().min(1).describe("Título do post, curto e chamativo"),
  content: z.string().min(1).describe("Corpo completo do post em Markdown")
})

export const reviewSchema = z.object({
  score: z.number().int().min(0).max(10).describe("Nota de 0 a 10; 7 ou mais = pronto"),
  issues: z.array(z.string()).describe("Problemas concretos encontrados"),
  suggestions: z.array(z.string()).describe("Ações para corrigir os problemas")
})

const draftReviewSchema = reviewSchema.extend({
  // Tentativa (1 = primeira versão) do rascunho avaliado
  attempt: z.number().int().min(1)
})

export type Draft = z.infer<typeof draftSchema>
export type Review = z.infer<typeof reviewSchema>
export type DraftReview = z.infer<typeof draftReviewSchema>

// Dados que atravessam as iterações do loop: entrada e saída de cada step
const iterationSchema = z.object({
  idea: z.string(),
  draft: draftSchema.nullable(),
  reviews: z.array(draftReviewSchema),
  attempt: z.number().int().min(0),
  done: z.boolean()
})

type Iteration = z.infer<typeof iterationSchema>

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function maxAttempts(): number {
  return positiveIntEnv("POST_REVIEW_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS)
}

export function minScore(): number {
  return positiveIntEnv("POST_REVIEW_MIN_SCORE", DEFAULT_MIN_SCORE)
}

function reviewTimeoutMs(): number {
  return positiveIntEnv("POST_REVIEW_TIMEOUT_MS", DEFAULT_REVIEW_TIMEOUT_MS)
}

// Sem review (o revisor falhou) não há feedback para reescrever: encerra com o que tem
export function isDone(review: Review | null, attempt: number): boolean {
  return review === null || review.score >= minScore() || attempt >= maxAttempts()
}

const bulletList = (items: string[]) =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : "- (nenhum)"

export function buildWritePrompt(
  idea: string,
  previous?: { draft: Draft; review: Review }
): string {
  if (!previous) return `Ideia do post: ${idea}`

  return [
    `Ideia do post: ${idea}`,
    "Reescreva o rascunho abaixo corrigindo os problemas apontados pelo revisor.",
    `Problemas:\n${bulletList(previous.review.issues)}`,
    `Sugestões:\n${bulletList(previous.review.suggestions)}`,
    `Título atual: ${previous.draft.title}`,
    `Conteúdo atual:\n${previous.draft.content}`
  ].join("\n\n")
}

export function buildReviewPrompt(idea: string, draft: Draft): string {
  return [
    `Ideia original: ${idea}`,
    `<rascunho>\nTítulo: ${draft.title}\n\n${draft.content}\n</rascunho>`
  ].join("\n\n")
}

const writeDraftStep = createStep({
  id: "write-draft",
  inputSchema: iterationSchema,
  outputSchema: iterationSchema,
  execute: async ({ inputData, mastra }): Promise<Iteration> => {
    const lastReview = inputData.reviews.at(-1)
    const previous =
      inputData.draft && lastReview ? { draft: inputData.draft, review: lastReview } : undefined

    const writer = mastra.getAgent(POST_WRITER_AGENT_ID)
    const { object } = await writer.generate(buildWritePrompt(inputData.idea, previous), {
      structuredOutput: { schema: draftSchema }
    })

    return { ...inputData, draft: object, attempt: inputData.attempt + 1 }
  }
})

// A falha do revisor não perde o rascunho: o loop termina e ele é salvo sem esse review
const reviewDraftStep = createStep({
  id: "review-draft",
  inputSchema: iterationSchema,
  outputSchema: iterationSchema,
  execute: async ({ inputData, mastra }): Promise<Iteration> => {
    const { idea, draft, attempt } = inputData
    if (!draft) throw new Error("review-draft executado sem rascunho")

    let review: Review | null = null

    try {
      const reviewer = mastra.getAgent(POST_REVIEWER_AGENT_ID)
      const { object } = await reviewer.generate(buildReviewPrompt(idea, draft), {
        structuredOutput: { schema: reviewSchema },
        abortSignal: AbortSignal.timeout(reviewTimeoutMs())
      })
      review = object
    } catch (error) {
      console.error("Falha na revisão do rascunho; será salvo sem esta revisão:", error)
    }

    return {
      ...inputData,
      reviews: review ? [...inputData.reviews, { ...review, attempt }] : inputData.reviews,
      done: isDone(review, attempt)
    }
  }
})

// Uma iteração do loop: escreve (ou reescreve) e revisa
const draftIteration = createWorkflow({
  id: "post-drafting-iteration",
  inputSchema: iterationSchema,
  outputSchema: iterationSchema
})
  .then(writeDraftStep)
  .then(reviewDraftStep)
  .commit()

export const postDraftingWorkflow = createWorkflow({
  id: POST_DRAFTING_WORKFLOW_ID,
  inputSchema: z.object({ idea: z.string().min(1) }),
  outputSchema: draftSchema.extend({ reviews: z.array(draftReviewSchema) }),
  // Execução síncrona e sem suspend/resume: não há o que retomar, então não guarda snapshots
  options: { shouldPersistSnapshot: () => false }
})
  .map(async ({ inputData }): Promise<Iteration> => ({
    idea: inputData.idea,
    draft: null,
    reviews: [],
    attempt: 0,
    done: false
  }))
  .dountil(draftIteration, async ({ inputData }) => inputData.done)
  .map(async ({ inputData }) => {
    if (!inputData.draft) throw new Error("Workflow terminou sem rascunho")
    return { ...inputData.draft, reviews: inputData.reviews }
  })
  .commit()
