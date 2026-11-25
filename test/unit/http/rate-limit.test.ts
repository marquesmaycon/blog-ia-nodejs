import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import request from "supertest"

import { createApp, type Request } from "../../../src/http/app.ts"
import { createRateLimiter, getClientIp } from "../../../src/http/rate-limit.ts"

const WINDOW_MS = 60_000

function setup(max = 2) {
  let current = 1_000_000
  const clock = {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    }
  }

  const limiter = createRateLimiter({ max, windowMs: WINDOW_MS, now: clock.now })
  const app = createApp()
  app.post("/limited", (req, res) => {
    if (!limiter.check(req, res)) return
    return { ok: true }
  })

  return { limiter, clock, api: () => request(app.server).post("/limited") }
}

function requestFrom(remoteAddress: string | undefined, forwardedFor?: string | string[]) {
  return {
    raw: { socket: { remoteAddress } },
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }
  } as unknown as Request<unknown>
}

describe("rate limit", () => {
  const originalTrustProxy = process.env.TRUST_PROXY

  beforeEach(() => {
    delete process.env.TRUST_PROXY
  })

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = originalTrustProxy
  })

  describe("createRateLimiter", () => {
    it("aceita até max e responde 429 com Retry-After na seguinte", async () => {
      const { api } = setup(2)

      await api().expect(200, { ok: true })
      await api().expect(200, { ok: true })
      const blocked = await api()

      assert.equal(blocked.status, 429)
      assert.deepEqual(blocked.body, { message: "Too Many Requests" })
      assert.equal(blocked.headers["retry-after"], "60")
    })

    it("informa a cota restante nos headers RateLimit-*", async () => {
      const { api, clock } = setup(2)

      const first = await api()
      assert.equal(first.headers["ratelimit-limit"], "2")
      assert.equal(first.headers["ratelimit-remaining"], "1")
      assert.equal(first.headers["ratelimit-reset"], "60")
      assert.equal(first.headers["retry-after"], undefined)

      clock.advance(15_500)
      const second = await api()
      assert.equal(second.headers["ratelimit-remaining"], "0")
      assert.equal(second.headers["ratelimit-reset"], "45")

      const blocked = await api()
      assert.equal(blocked.headers["ratelimit-remaining"], "0")
      assert.equal(blocked.headers["retry-after"], "45")
    })

    it("renova a cota quando a janela termina", async () => {
      const { api, clock } = setup(1)

      await api().expect(200)
      await api().expect(429)

      clock.advance(WINDOW_MS - 1)
      await api().expect(429)

      clock.advance(1)
      const renewed = await api().expect(200)
      assert.equal(renewed.headers["ratelimit-remaining"], "0")
    })

    it("mantém cotas independentes por IP", async () => {
      process.env.TRUST_PROXY = "true"
      const { api } = setup(1)

      await api().set("X-Forwarded-For", "203.0.113.1").expect(200)
      await api().set("X-Forwarded-For", "203.0.113.1").expect(429)
      await api().set("X-Forwarded-For", "203.0.113.2").expect(200)
    })

    it("ignora X-Forwarded-For sem TRUST_PROXY: trocar o header não gera cota nova", async () => {
      const { api } = setup(1)

      await api().set("X-Forwarded-For", "203.0.113.1").expect(200)
      await api().set("X-Forwarded-For", "203.0.113.2").expect(429)
    })

    it("remove da memória as janelas vencidas", async () => {
      process.env.TRUST_PROXY = "true"
      const { api, clock, limiter } = setup(1)

      await api().set("X-Forwarded-For", "203.0.113.1").expect(200)
      await api().set("X-Forwarded-For", "203.0.113.2").expect(200)
      assert.equal(limiter.size, 2)

      clock.advance(WINDOW_MS)
      await api().set("X-Forwarded-For", "203.0.113.3").expect(200)
      assert.equal(limiter.size, 1)
    })
  })

  describe("getClientIp", () => {
    it("usa o IP da conexão por padrão", () => {
      assert.equal(getClientIp(requestFrom("10.0.0.1", "203.0.113.1")), "10.0.0.1")
    })

    it("com TRUST_PROXY=true usa o primeiro IP do X-Forwarded-For", () => {
      process.env.TRUST_PROXY = "true"

      assert.equal(getClientIp(requestFrom("10.0.0.1", " 203.0.113.1 , 10.0.0.2")), "203.0.113.1")
      assert.equal(getClientIp(requestFrom("10.0.0.1", ["203.0.113.9", "10.0.0.2"])), "203.0.113.9")
    })

    it("com TRUST_PROXY=true e sem header, cai no IP da conexão", () => {
      process.env.TRUST_PROXY = "true"

      assert.equal(getClientIp(requestFrom("10.0.0.1")), "10.0.0.1")
      assert.equal(getClientIp(requestFrom("10.0.0.1", "")), "10.0.0.1")
    })

    it("devolve 'unknown' quando a conexão não tem endereço", () => {
      assert.equal(getClientIp(requestFrom(undefined)), "unknown")
    })
  })
})
