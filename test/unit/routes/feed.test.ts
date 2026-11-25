// Testa a rota do feed isoladamente: o service é substituído por mock.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

const services = {
  getFeed: mock.fn(async (): Promise<string> => "<rss/>")
}

mock.module(import.meta.resolve("../../../src/services/feed.ts"), { exports: services })

const { createApp } = await import("../../../src/http/app.ts")
const { registerFeedRoutes } = await import("../../../src/routes/feed.ts")

function buildServer() {
  const app = createApp()
  registerFeedRoutes(app)
  return app.server
}

describe("rota /feed.xml", () => {
  beforeEach(() => {
    services.getFeed.mock.resetCalls()
    mock.method(console, "error", () => {})
  })

  afterEach(() => mock.restoreAll())

  it("responde o XML com o content-type de RSS", async () => {
    const res = await request(buildServer())
      .get("/feed.xml")
      .buffer(true)
      .parse((r, cb) => {
        let data = ""
        r.on("data", (chunk: Buffer) => (data += chunk))
        r.on("end", () => cb(null, data))
      })

    assert.equal(res.status, 200)
    assert.equal(res.headers["content-type"], "application/rss+xml; charset=utf-8")
    assert.equal(res.body, "<rss/>")
  })

  it("responde 500 quando o service falha", async () => {
    services.getFeed.mock.mockImplementationOnce(async () => {
      throw new Error("db down")
    })

    const res = await request(buildServer()).get("/feed.xml")

    assert.equal(res.status, 500)
    assert.deepEqual(res.body, { message: "Failed to build feed" })
  })
})
