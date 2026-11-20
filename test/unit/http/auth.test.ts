import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import type { Request } from "../../../src/http/app.ts"
import { hasValidApiKey } from "../../../src/http/auth.ts"

function requestWith(authorization?: string) {
  return { headers: authorization === undefined ? {} : { authorization } } as Request<unknown>
}

describe("hasValidApiKey", () => {
  const originalApiKey = process.env.API_KEY

  beforeEach(() => {
    process.env.API_KEY = "secret"
  })

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.API_KEY
    else process.env.API_KEY = originalApiKey
  })

  it("aceita o Bearer token igual à API_KEY", () => {
    assert.equal(hasValidApiKey(requestWith("Bearer secret")), true)
  })

  it("aceita o scheme em qualquer caixa e espaços extras", () => {
    assert.equal(hasValidApiKey(requestWith("  bEaReR   secret  ")), true)
  })

  it("rejeita quando não há header Authorization", () => {
    assert.equal(hasValidApiKey(requestWith()), false)
  })

  it("rejeita um token diferente", () => {
    assert.equal(hasValidApiKey(requestWith("Bearer wrong")), false)
  })

  it("rejeita um scheme diferente de Bearer", () => {
    assert.equal(hasValidApiKey(requestWith("Basic secret")), false)
  })

  it("rejeita o scheme sem token", () => {
    assert.equal(hasValidApiKey(requestWith("Bearer")), false)
  })

  it("bloqueia tudo quando a API_KEY não está configurada", () => {
    delete process.env.API_KEY
    assert.equal(hasValidApiKey(requestWith("Bearer ")), false)
    assert.equal(hasValidApiKey(requestWith("Bearer undefined")), false)
  })
})
