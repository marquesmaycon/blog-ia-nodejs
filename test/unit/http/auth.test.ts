import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import type { Reply, Request } from "../../../src/http/app.ts"
import { hasValidApiKey, requireApiKey } from "../../../src/http/auth.ts"

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

function fakeReply() {
  const sent: { status?: number; payload?: unknown } = {}
  const reply = {
    status(code: number) {
      sent.status = code
      return reply
    },
    send(payload?: unknown) {
      sent.payload = payload
    }
  }
  return { reply: reply as unknown as Reply, sent }
}

describe("requireApiKey", () => {
  const originalApiKey = process.env.API_KEY

  beforeEach(() => {
    process.env.API_KEY = "secret"
  })

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.API_KEY
    else process.env.API_KEY = originalApiKey
  })

  it("retorna true e não responde nada com a API key válida", () => {
    const { reply, sent } = fakeReply()

    assert.equal(requireApiKey(requestWith("Bearer secret"), reply), true)
    assert.deepEqual(sent, {})
  })

  for (const [name, authorization] of [
    ["sem header Authorization", undefined],
    ["com token errado", "Bearer wrong"]
  ] as const) {
    it(`retorna false e responde 403 ${name}`, () => {
      const { reply, sent } = fakeReply()

      assert.equal(requireApiKey(requestWith(authorization), reply), false)
      assert.deepEqual(sent, { status: 403, payload: { message: "Forbidden" } })
    })
  }
})
