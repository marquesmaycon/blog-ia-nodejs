// Testa as regras do editor de pauta: o Mastra é substituído por um mock.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

type GenerateOptions = {
  structuredOutput: { schema: unknown }
  maxSteps: number
  abortSignal: AbortSignal
}

const idea = {
  title: "  Testando streams  ",
  idea: "  Um guia de testes de streams com node:test.  ",
  rationale: "  O post de streams é o mais curtido.  ",
  suggested_tags: ["Node.js", " node.js ", "Testes", "Streams", "Extra"],
  inspired_by: ["streams", "streams", "slug-inventado"]
}

// Formato do retorno do generate: as tools aparecem em `steps[].toolResults`
const toolResult = (result: unknown) => ({
  type: "tool-result",
  payload: { toolName: "x", result }
})
const steps = [
  { toolResults: [toolResult({ posts: [{ slug: "streams" }, { slug: "testes" }] })] },
  { toolResults: [toolResult({ tags: [{ slug: "node-js" }] })] }
]

const generate = mock.fn(async (_prompt: string, _options: GenerateOptions): Promise<unknown> => ({
  object: { ideas: [idea] },
  steps
}))
const getAgent = mock.fn((_id: string) => ({ generate }))

mock.module(import.meta.resolve("../../../src/mastra/index.ts"), {
  exports: { mastra: { getAgent } }
})
mock.module(import.meta.resolve("../../../src/mastra/agents/editorial-planner.ts"), {
  exports: { EDITORIAL_PLANNER_AGENT_ID: "editorial-planner" }
})

const { buildPrompt, collectToolSlugs, generateEditorialIdeas } =
  await import("../../../src/services/editorial.ts")

const options = { count: 3, days: 7 }

describe("services/editorial", () => {
  beforeEach(() => {
    generate.mock.resetCalls()
    getAgent.mock.resetCalls()
    mock.method(console, "error", () => {})
  })

  afterEach(() => {
    mock.restoreAll()
    delete process.env.EDITORIAL_IDEAS_TIMEOUT_MS
  })

  describe("generateEditorialIdeas", () => {
    it("chama o agente com structured output, limite de passos e timeout", async () => {
      await generateEditorialIdeas(options)

      assert.deepEqual(getAgent.mock.calls[0].arguments, ["editorial-planner"])
      const [prompt, generateOptions] = generate.mock.calls[0].arguments
      assert.equal(prompt, buildPrompt(options))
      assert.ok(generateOptions.structuredOutput.schema)
      assert.ok(generateOptions.maxSteps > 1)
      assert.ok(generateOptions.abortSignal instanceof AbortSignal)
    })

    it("normaliza as ideias: trim, tags sem repetição (até 3) e só slugs vindos das tools", async () => {
      const result = await generateEditorialIdeas(options)

      assert.deepEqual(result, {
        ok: true,
        ideas: [
          {
            title: "Testando streams",
            idea: "Um guia de testes de streams com node:test.",
            rationale: "O post de streams é o mais curtido.",
            suggested_tags: ["Node.js", "Testes", "Streams"],
            inspired_by: ["streams"]
          }
        ]
      })
    })

    it("corta a lista em `count` e descarta ideias sem título ou descrição", async () => {
      generate.mock.mockImplementationOnce(async () => ({
        object: {
          ideas: [
            { ...idea, title: "   " },
            { ...idea, title: "A" },
            { ...idea, idea: "" },
            { ...idea, title: "B" },
            { ...idea, title: "C" }
          ]
        }
      }))

      const result = await generateEditorialIdeas({ count: 2, days: 7 })

      assert.ok(result.ok)
      assert.deepEqual(
        result.ideas.map((item) => item.title),
        ["A", "B"]
      )
      // Sem tool results, nenhum slug é confiável
      assert.deepEqual(result.ideas[0].inspired_by, [])
    })

    it("devolve generation_failed quando o agente falha", async () => {
      generate.mock.mockImplementationOnce(async () => {
        throw new Error("LLM fora do ar")
      })

      assert.deepEqual(await generateEditorialIdeas(options), {
        ok: false,
        error: "generation_failed"
      })
    })

    it("devolve generation_failed quando o objeto não segue o schema", async () => {
      generate.mock.mockImplementationOnce(async () => ({ object: { ideas: [{ title: 1 }] } }))

      assert.deepEqual(await generateEditorialIdeas(options), {
        ok: false,
        error: "generation_failed"
      })
    })

    it("aborta pelo EDITORIAL_IDEAS_TIMEOUT_MS", async () => {
      process.env.EDITORIAL_IDEAS_TIMEOUT_MS = "1"
      generate.mock.mockImplementationOnce(async (_prompt, { abortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        abortSignal.throwIfAborted()
        return { object: { ideas: [] } }
      })

      assert.deepEqual(await generateEditorialIdeas(options), {
        ok: false,
        error: "generation_failed"
      })
    })
  })

  describe("buildPrompt", () => {
    it("pede a quantidade e a janela, e põe o foco entre <foco>", () => {
      const prompt = buildPrompt({ count: 4, days: 14, focus: "testes" })

      assert.match(prompt, /4 ideias/)
      assert.match(prompt, /days=14/)
      assert.match(prompt, /<foco>\ntestes\n<\/foco>/)
    })

    it("sem foco, não manda a tag <foco>", () => {
      assert.doesNotMatch(buildPrompt(options), /<foco>/)
    })
  })

  describe("collectToolSlugs", () => {
    it("junta os slugs de posts do retorno final e de todos os passos", () => {
      const slugs = collectToolSlugs({
        toolResults: [toolResult({ posts: [{ slug: "final" }] })],
        steps: [...steps, { toolResults: [toolResult("texto"), toolResult({ posts: "x" })] }]
      })

      assert.deepEqual([...slugs].toSorted(), ["final", "streams", "testes"])
    })
  })
})
