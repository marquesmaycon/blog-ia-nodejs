// Escreve o post e o submete ao revisor; abaixo da nota mínima, reescreve com o feedback.
// No fim, o agente de SEO gera resumo, meta description, slug e tags da versão final.
// O workflow só gera: quem persiste o rascunho e os reviews é o service (createPostDraft).
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { META_DESCRIPTION_MAX_LENGTH, SUMMARY_MAX_LENGTH } from "../../utils/seo.ts"
import { truncate } from "../../utils/truncate.ts"
import { POST_REVIEWER_AGENT_ID } from "../agents/post-reviewer.ts"
import { POST_SEO_AGENT_ID } from "../agents/post-seo.ts"
import { POST_WRITER_AGENT_ID } from "../agents/post-writer.ts"

export const POST_DRAFTING_WORKFLOW_ID = "post-drafting"

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_MIN_SCORE = 7
const DEFAULT_REVIEW_TIMEOUT_MS = 30_000
const DEFAULT_SEO_TIMEOUT_MS = 20_000

export const MAX_SEO_TAGS = 5

export const draftSchema = z.object({
  title: z.string().min(1).describe("Título do post, curto e chamativo"),
  content: z.string().min(1).describe("Corpo completo do post em Markdown")
})

export const reviewSchema = z.object({
  score: z.number().int().min(0).max(10).describe("Nota de 0 a 10; 7 ou mais = pronto"),
  issues: z.array(z.string()).describe("Problemas concretos encontrados"),
  suggestions: z.array(z.string()).describe("Ações para corrigir os problemas")
})

// Sem .max(): um limite estourado pelo modelo não derruba a geração; o normalizeSeo corta
export const seoSchema = z.object({
  summary: z
    .string()
    .describe(`Resumo de uma ou duas frases, até ${SUMMARY_MAX_LENGTH} caracteres`),
  meta_description: z
    .string()
    .describe(`Descrição para buscadores, até ${META_DESCRIPTION_MAX_LENGTH} caracteres`),
  slug: z.string().describe("Slug curto em kebab-case, sem acentos"),
  tags: z.array(z.string()).describe(`De 1 a ${MAX_SEO_TAGS} tags; prefira as existentes`)
})

// O SEO já normalizado: textos vazios viram null e os limites são garantidos
const postSeoSchema = z.object({
  summary: z.string().nullable(),
  meta_description: z.string().nullable(),
  slug: z.string(),
  tags: z.array(z.string())
})

const draftReviewSchema = reviewSchema.extend({
  // Tentativa (1 = primeira versão) do rascunho avaliado
  attempt: z.number().int().min(1)
})

export type Draft = z.infer<typeof draftSchema>
export type Review = z.infer<typeof reviewSchema>
export type DraftReview = z.infer<typeof draftReviewSchema>
export type Seo = z.infer<typeof seoSchema>
export type PostSeo = z.infer<typeof postSeoSchema>

// Dados que atravessam as iterações do loop: entrada e saída de cada step
const iterationSchema = z.object({
  idea: z.string(),
  // Vocabulário de tags do blog; só o step de SEO usa, mas precisa atravessar o loop
  existingTags: z.array(z.string()),
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

function seoTimeoutMs(): number {
  return positiveIntEnv("POST_SEO_TIMEOUT_MS", DEFAULT_SEO_TIMEOUT_MS)
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

export function buildSeoPrompt(draft: Draft, existingTags: string[]): string {
  return [
    `Tags existentes: ${existingTags.length ? existingTags.join(", ") : "(nenhuma)"}`,
    `<rascunho>\nTítulo: ${draft.title}\n\n${draft.content}\n</rascunho>`
  ].join("\n\n")
}

// Junta os espaços e corta no limite; texto vazio vira null
function seoText(value: string, maxLength: number): string | null {
  const trimmed = value.replace(/\s+/g, " ").trim()
  return trimmed ? truncate(trimmed, maxLength) : null
}

// Garante os limites que o modelo pode não respeitar: corta os textos, troca vazios por null
// e descarta tags vazias ou repetidas (ignorando caixa), ficando com as MAX_SEO_TAGS primeiras
export function normalizeSeo(seo: Seo): PostSeo {
  const seen = new Set<string>()
  const tags = seo.tags
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase()
      if (!tag || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_SEO_TAGS)

  return {
    summary: seoText(seo.summary, SUMMARY_MAX_LENGTH),
    meta_description: seoText(seo.meta_description, META_DESCRIPTION_MAX_LENGTH),
    slug: seo.slug.trim(),
    tags
  }
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

const draftingOutputSchema = draftSchema.extend({
  reviews: z.array(draftReviewSchema),
  // null quando o agente de SEO falhou: o service usa o título para o slug e não aplica tags
  seo: postSeoSchema.nullable()
})

// Como no revisor, a falha do SEO não perde o rascunho: ele segue sem os metadados
const generateSeoStep = createStep({
  id: "generate-seo",
  inputSchema: iterationSchema,
  outputSchema: draftingOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const { draft, reviews, existingTags } = inputData
    if (!draft) throw new Error("Workflow terminou sem rascunho")

    let seo: PostSeo | null = null

    try {
      const agent = mastra.getAgent(POST_SEO_AGENT_ID)
      const { object } = await agent.generate(buildSeoPrompt(draft, existingTags), {
        structuredOutput: { schema: seoSchema },
        abortSignal: AbortSignal.timeout(seoTimeoutMs())
      })
      seo = normalizeSeo(object)
    } catch (error) {
      console.error("Falha ao gerar o SEO do rascunho; será salvo sem os metadados:", error)
    }

    return { ...draft, reviews, seo }
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
  inputSchema: z.object({ idea: z.string().min(1), existingTags: z.array(z.string()).optional() }),
  outputSchema: draftingOutputSchema,
  // Execução síncrona e sem suspend/resume: não há o que retomar, então não guarda snapshots
  options: { shouldPersistSnapshot: () => false }
})
  .map(async ({ inputData }): Promise<Iteration> => ({
    idea: inputData.idea,
    existingTags: inputData.existingTags ?? [],
    draft: null,
    reviews: [],
    attempt: 0,
    done: false
  }))
  .dountil(draftIteration, async ({ inputData }) => inputData.done)
  .then(generateSeoStep)
  .commit()
