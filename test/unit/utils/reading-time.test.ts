import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { readingTimeMinutes } from "../../../src/utils/reading-time.ts"

const words = (count: number) => Array.from({ length: count }, () => "palavra").join(" ")

describe("utils/reading-time", () => {
  const cases = [
    ["vazio", "", 1],
    ["só espaços", "  \n\t ", 1],
    ["1 palavra", "oi", 1],
    ["200 palavras", words(200), 1],
    ["201 palavras", words(201), 2],
    ["1000 palavras com quebras de linha", words(1000).replaceAll(" ", "\n\n"), 5]
  ] as const

  for (const [name, content, expected] of cases) {
    it(`${name} -> ${expected} min`, () => {
      assert.equal(readingTimeMinutes(content), expected)
    })
  }

  it("aceita outra velocidade de leitura", () => {
    assert.equal(readingTimeMinutes(words(300), 100), 3)
  })
})
