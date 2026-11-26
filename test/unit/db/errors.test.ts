import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isUniqueViolation } from "../../../src/db/errors.ts"

describe("db/errors", () => {
  describe("isUniqueViolation", () => {
    it("reconhece a violação da constraint informada", () => {
      const error = Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "posts_slug_key"
      })

      assert.equal(isUniqueViolation(error, "posts_slug_key"), true)
    })

    it("aceita objetos simples com o mesmo formato", () => {
      const error = { code: "23505", constraint: "comments_ai_reply_per_parent_idx" }

      assert.equal(isUniqueViolation(error, "comments_ai_reply_per_parent_idx"), true)
    })

    it("ignora a violação de outra constraint", () => {
      assert.equal(
        isUniqueViolation({ code: "23505", constraint: "tags_slug_key" }, "posts_slug_key"),
        false
      )
    })

    it("ignora outros códigos de erro", () => {
      // 23503: foreign_key_violation
      assert.equal(
        isUniqueViolation({ code: "23503", constraint: "posts_slug_key" }, "posts_slug_key"),
        false
      )
    })

    it("ignora erros sem code ou sem constraint", () => {
      assert.equal(isUniqueViolation(new Error("boom"), "posts_slug_key"), false)
      assert.equal(isUniqueViolation({ code: "23505" }, "posts_slug_key"), false)
    })

    it("ignora valores que não são objetos", () => {
      assert.equal(isUniqueViolation(null, "posts_slug_key"), false)
      assert.equal(isUniqueViolation(undefined, "posts_slug_key"), false)
      assert.equal(isUniqueViolation("23505", "posts_slug_key"), false)
    })
  })
})
