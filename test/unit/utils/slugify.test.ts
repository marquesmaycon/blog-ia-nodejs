import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { slugify } from "../../../src/utils/slugify.ts"

describe("utils/slugify", () => {
  const cases = [
    ["Node.js", "node-js"],
    ["Programação Funcional", "programacao-funcional"],
    ["  IA   generativa  ", "ia-generativa"],
    ["C++ & Rust!", "c-rust"],
    ["já-é-slug", "ja-e-slug"],
    ["ES2026", "es2026"],
    ["!!!", ""],
    ["", ""]
  ] as const

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(slugify(input), expected)
    })
  }
})
