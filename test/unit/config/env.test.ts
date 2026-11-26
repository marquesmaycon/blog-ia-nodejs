import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import { env, validateEnv } from "../../../src/config/env.ts"

describe("config/env", () => {
  describe("env", () => {
    it("aplica os defaults quando nada está definido", () => {
      const config = env({})

      assert.equal(config.API_PORT, 8080)
      assert.equal(config.API_PROTOCOL, "http")
      assert.equal(config.API_HOST, undefined)
      assert.equal(config.API_KEY, undefined)
      assert.equal(config.SITE_URL, undefined)
      assert.equal(config.DATABASE_URL, undefined)
      assert.equal(config.TRUST_PROXY, false)
      assert.equal(config.POST_WRITER_MODEL, "google/gemini-2.5-flash")
      assert.equal(config.EDITORIAL_PLANNER_MODEL, "google/gemini-2.5-flash")
      assert.equal(config.COMMENT_MODERATION_TIMEOUT_MS, 10_000)
      assert.equal(config.COMMENT_REPLY_TIMEOUT_MS, 20_000)
      assert.equal(config.POST_REVIEW_TIMEOUT_MS, 30_000)
      assert.equal(config.POST_SEO_TIMEOUT_MS, 20_000)
      assert.equal(config.EDITORIAL_IDEAS_TIMEOUT_MS, 60_000)
      assert.equal(config.POST_REVIEW_MIN_SCORE, 7)
      assert.equal(config.POST_REVIEW_MAX_ATTEMPTS, 3)
    })

    it("converte os valores definidos", () => {
      const config = env({
        API_PORT: "3000",
        API_KEY: "secret",
        TRUST_PROXY: "true",
        POST_SEO_MODEL: "groq/llama",
        COMMENT_REPLY_TIMEOUT_MS: "1500",
        POST_REVIEW_MAX_ATTEMPTS: "5"
      })

      assert.equal(config.API_PORT, 3000)
      assert.equal(config.API_KEY, "secret")
      assert.equal(config.TRUST_PROXY, true)
      assert.equal(config.POST_SEO_MODEL, "groq/llama")
      assert.equal(config.COMMENT_REPLY_TIMEOUT_MS, 1500)
      assert.equal(config.POST_REVIEW_MAX_ATTEMPTS, 5)
    })

    it("trata string vazia como variável ausente", () => {
      const config = env({ API_KEY: "", SITE_URL: "", POST_WRITER_MODEL: "", API_PORT: "" })

      assert.equal(config.API_KEY, undefined)
      assert.equal(config.SITE_URL, undefined)
      assert.equal(config.POST_WRITER_MODEL, "google/gemini-2.5-flash")
      assert.equal(config.API_PORT, 8080)
    })

    it("cai no default quando o valor é inválido", () => {
      const config = env({
        API_PORT: "porta",
        TRUST_PROXY: "yes",
        COMMENT_MODERATION_TIMEOUT_MS: "abc",
        COMMENT_REPLY_TIMEOUT_MS: "-5",
        EDITORIAL_IDEAS_TIMEOUT_MS: "1500.5",
        POST_REVIEW_MIN_SCORE: "11",
        POST_REVIEW_MAX_ATTEMPTS: "0"
      })

      assert.equal(config.API_PORT, 8080)
      assert.equal(config.TRUST_PROXY, false)
      assert.equal(config.COMMENT_MODERATION_TIMEOUT_MS, 10_000)
      assert.equal(config.COMMENT_REPLY_TIMEOUT_MS, 20_000)
      assert.equal(config.EDITORIAL_IDEAS_TIMEOUT_MS, 60_000)
      assert.equal(config.POST_REVIEW_MIN_SCORE, 7)
      assert.equal(config.POST_REVIEW_MAX_ATTEMPTS, 3)
    })

    it("aceita POST_REVIEW_MIN_SCORE igual a 0", () => {
      assert.equal(env({ POST_REVIEW_MIN_SCORE: "0" }).POST_REVIEW_MIN_SCORE, 0)
    })

    describe("leitura de process.env", () => {
      const originalApiKey = process.env.API_KEY

      afterEach(() => {
        if (originalApiKey === undefined) delete process.env.API_KEY
        else process.env.API_KEY = originalApiKey
      })

      it("reflete alterações feitas em runtime", () => {
        process.env.API_KEY = "first"
        assert.equal(env().API_KEY, "first")

        process.env.API_KEY = "second"
        assert.equal(env().API_KEY, "second")

        delete process.env.API_KEY
        assert.equal(env().API_KEY, undefined)
      })
    })
  })

  describe("validateEnv", () => {
    it("não aponta problemas num ambiente válido", () => {
      assert.deepEqual(validateEnv({}), [])
      assert.deepEqual(
        validateEnv({ API_PORT: "3000", TRUST_PROXY: "false", POST_REVIEW_MIN_SCORE: "0" }),
        []
      )
    })

    it("lista cada variável inválida pelo nome", () => {
      const issues = validateEnv({
        TRUST_PROXY: "yes",
        COMMENT_REPLY_TIMEOUT_MS: "abc",
        POST_REVIEW_MIN_SCORE: "11"
      })

      assert.equal(issues.length, 3)
      assert.deepEqual(issues.map((issue) => issue.split(":")[0]).toSorted(), [
        "COMMENT_REPLY_TIMEOUT_MS",
        "POST_REVIEW_MIN_SCORE",
        "TRUST_PROXY"
      ])
    })
  })
})
