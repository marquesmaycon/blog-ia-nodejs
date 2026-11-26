import { z } from "zod"

import { env } from "../config/env.ts"
import { EDITORIAL_PLANNER_AGENT_ID } from "../mastra/agents/editorial-planner.ts"
import { mastra } from "../mastra/index.ts"
import { slugify } from "../utils/slugify.ts"

const ideasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe("Título provisório do post"),
      idea: z.string().describe("Descrição do post, pronta para o redator"),
      rationale: z.string().describe("Por que a pauta faz sentido agora"),
      suggested_tags: z.array(z.string()).describe("De 1 a 3 tags"),
      inspired_by: z.array(z.string()).describe("Slugs dos posts que motivaram a ideia")
    })
  )
})

export type EditorialIdea = z.infer<typeof ideasSchema>["ideas"][number]

export type EditorialIdeasOptions = {
  count: number
  days: number
  focus?: string
}

export type EditorialIdeasResult =
  | { ok: true; ideas: EditorialIdea[] }
  | { ok: false; error: "generation_failed" }

const MAX_SUGGESTED_TAGS = 3
// Cada tool chamada é um passo; folga para as buscas de checagem de cada ideia
const MAX_STEPS = 12

export function buildPrompt({ count, days, focus }: EditorialIdeasOptions): string {
  return [
    `Sugira ${count} ideias de novos posts.`,
    `Considere o engajamento dos últimos ${days} dias (use days=${days} em getPopularPosts).`,
    focus ? `<foco>\n${focus}\n</foco>` : "Sem foco específico: escolha os temas pelo engajamento."
  ].join("\n\n")
}

type ToolResultLike = { payload?: { result?: unknown } }
type GenerateResultLike = {
  toolResults?: ToolResultLike[]
  steps?: { toolResults?: ToolResultLike[] }[]
}

// Slugs de todos os posts que as tools devolveram ao modelo, em qualquer passo.
// É contra eles que o `inspired_by` é conferido: slug fora daqui foi inventado.
export function collectToolSlugs(result: GenerateResultLike): Set<string> {
  const chunks = [
    ...(result.toolResults ?? []),
    ...(result.steps ?? []).flatMap((step) => step.toolResults ?? [])
  ]
  const slugs = new Set<string>()

  for (const chunk of chunks) {
    const output = chunk.payload?.result
    if (typeof output !== "object" || output === null || !("posts" in output)) continue
    if (!Array.isArray(output.posts)) continue

    for (const post of output.posts) {
      if (typeof post?.slug === "string") slugs.add(post.slug)
    }
  }

  return slugs
}

// Sem repetição pelo slug (como as tags do blog), mantendo o primeiro nome
function uniqueTags(names: string[]): string[] {
  const bySlug = new Map<string, string>()

  for (const name of names.map((value) => value.trim())) {
    const slug = slugify(name)
    if (slug && !bySlug.has(slug)) bySlug.set(slug, name)
  }

  return [...bySlug.values()].slice(0, MAX_SUGGESTED_TAGS)
}

function normalizeIdeas(
  ideas: EditorialIdea[],
  knownSlugs: Set<string>,
  count: number
): EditorialIdea[] {
  return ideas
    .map((idea) => ({
      title: idea.title.trim(),
      idea: idea.idea.trim(),
      rationale: idea.rationale.trim(),
      suggested_tags: uniqueTags(idea.suggested_tags),
      inspired_by: [...new Set(idea.inspired_by)].filter((slug) => knownSlugs.has(slug))
    }))
    .filter((idea) => idea.title && idea.idea)
    .slice(0, count)
}

// O agente consulta o blog pelas tools (populares, tags, busca) e devolve as pautas.
// A falha da IA é devolvida: foi o admin quem pediu as ideias.
export async function generateEditorialIdeas(
  options: EditorialIdeasOptions
): Promise<EditorialIdeasResult> {
  try {
    const agent = mastra.getAgent(EDITORIAL_PLANNER_AGENT_ID)
    const result = await agent.generate(buildPrompt(options), {
      structuredOutput: { schema: ideasSchema },
      maxSteps: MAX_STEPS,
      abortSignal: AbortSignal.timeout(env().EDITORIAL_IDEAS_TIMEOUT_MS)
    })
    const { ideas } = ideasSchema.parse(result.object)

    return {
      ok: true,
      ideas: normalizeIdeas(ideas, collectToolSlugs(result as GenerateResultLike), options.count)
    }
  } catch (error) {
    console.error("Falha ao gerar as pautas:", error)
    return { ok: false, error: "generation_failed" }
  }
}
