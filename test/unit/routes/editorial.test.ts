// Testa a rota do editor de pauta isoladamente: o service é substituído por um mock.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import type {
  EditorialIdea,
  EditorialIdeasOptions,
  EditorialIdeasResult
} from "../../../src/services/editorial.ts"

const idea: EditorialIdea = {
  title: "Testando streams",
  idea: "Um guia de testes de streams.",
  rationale: "O post de streams é o mais curtido.",
  suggested_tags: ["Node.js"],
  inspired_by: ["streams"]
}

const services = {
  generateEditorialIdeas: mock.fn(
    async (_options: EditorialIdeasOptions): Promise<EditorialIdeasResult> => ({
      ok: true,
      ideas: [idea]
    })
  )
}

mock.module(import.meta.resolve("../../../src/services/editorial.ts"), { exports: services })

const { createApp } = await import("../../../src/http/app.ts")
const { registerEditorialRoutes } = await import("../../../src/routes/editorial.ts")

const auth = { Authorization: "Bearer secret" }

function buildServer() {
  const app = createApp()
  registerEditorialRoutes(app)
  return app.server
}

describe("rotas do editor de pauta", () => {
  const originalApiKey = process.env.API_KEY

  beforeEach(() => {
    process.env.API_KEY = "secret"
    services.generateEditorialIdeas.mock.resetCalls()
    mock.method(console, "error", () => {})
  })

  afterEach(() => {
    mock.restoreAll()
    if (originalApiKey === undefined) delete process.env.API_KEY
    else process.env.API_KEY = originalApiKey
  })

  describe("POST /editorial/ideas", () => {
    it("responde 403 sem API key e não chama o agente", async () => {
      const res = await request(buildServer()).post("/editorial/ideas")

      assert.equal(res.status, 403)
      assert.deepEqual(res.body, { message: "Forbidden" })
      assert.equal(services.generateEditorialIdeas.mock.callCount(), 0)
    })

    it("sem body, usa os padrões e responde 200 com as ideias", async () => {
      const res = await request(buildServer()).post("/editorial/ideas").set(auth)

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { data: { ideas: [idea] } })
      assert.deepEqual(services.generateEditorialIdeas.mock.calls[0].arguments, [
        { count: 5, days: 30 }
      ])
    })

    it("repassa count, days e o foco com trim", async () => {
      await request(buildServer())
        .post("/editorial/ideas")
        .set(auth)
        .send({ count: 3, days: 7, focus: "  testes  " })

      assert.deepEqual(services.generateEditorialIdeas.mock.calls[0].arguments, [
        { count: 3, days: 7, focus: "testes" }
      ])
    })

    it("foco vazio vale como sem foco", async () => {
      await request(buildServer()).post("/editorial/ideas").set(auth).send({ focus: "   " })

      assert.equal(services.generateEditorialIdeas.mock.calls[0].arguments[0].focus, undefined)
    })

    const invalidBodies: [string, object][] = [
      ["count 0", { count: 0 }],
      ["count 11", { count: 11 }],
      ["days 366", { days: 366 }],
      ["count fracionário", { count: 1.5 }],
      ["focus acima de 200 caracteres", { focus: "x".repeat(201) }]
    ]

    for (const [label, body] of invalidBodies) {
      it(`responde 400 com body inválido (${label})`, async () => {
        const res = await request(buildServer()).post("/editorial/ideas").set(auth).send(body)

        assert.equal(res.status, 400)
        assert.equal(res.body.message, "Invalid request body")
        assert.equal(services.generateEditorialIdeas.mock.callCount(), 0)
      })
    }

    it("responde 502 quando o agente falha", async () => {
      services.generateEditorialIdeas.mock.mockImplementationOnce(async () => ({
        ok: false,
        error: "generation_failed"
      }))

      const res = await request(buildServer()).post("/editorial/ideas").set(auth)

      assert.equal(res.status, 502)
      assert.deepEqual(res.body, { message: "Failed to generate ideas" })
    })

    it("responde 500 quando o service lança", async () => {
      services.generateEditorialIdeas.mock.mockImplementationOnce(async () => {
        throw new Error("boom")
      })

      const res = await request(buildServer()).post("/editorial/ideas").set(auth)

      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { message: "Failed to generate ideas" })
    })
  })
})
