// Feed RSS pela API HTTP (supertest), com Postgres real (banco blog_test).
import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { registerFeedRoutes } from "../../src/routes/feed.ts"
import { pool, seedPost, truncatePosts } from "../helpers/db.ts"

const app = createApp()
registerFeedRoutes(app)

// O supertest só faz parse de JSON/texto; o XML chega como string crua
const getFeed = () =>
  request(app.server)
    .get("/feed.xml")
    .buffer(true)
    .parse((res, callback) => {
      let data = ""
      res.on("data", (chunk: Buffer) => (data += chunk))
      res.on("end", () => callback(null, data))
    })

const itemTitles = (xml: string) =>
  [...xml.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((match) => match[1])

describe("E2E /feed.xml", () => {
  const originalSiteUrl = process.env.SITE_URL

  before(() => {
    process.env.SITE_URL = "https://blog.test"
  })

  beforeEach(truncatePosts)

  after(async () => {
    if (originalSiteUrl === undefined) delete process.env.SITE_URL
    else process.env.SITE_URL = originalSiteUrl
    await pool.end()
  })

  it("lista só os aprovados, do mais recente para o mais antigo", async () => {
    await seedPost({
      title: "Antigo",
      slug: "antigo",
      approved_at: "2026-01-01T00:00:00.000Z",
      published_at: "2026-01-01T00:00:00.000Z"
    })
    await seedPost({
      title: "Recente & novo",
      slug: "recente",
      approved_at: "2026-01-03T00:00:00.000Z",
      published_at: "2026-01-03T00:00:00.000Z"
    })
    await seedPost({ title: "Rascunho", slug: "rascunho" })
    await seedPost({
      title: "Reprovado",
      slug: "reprovado",
      rejected_at: "2026-01-02T00:00:00.000Z"
    })

    const res = await getFeed().expect(200)

    assert.equal(res.headers["content-type"], "application/rss+xml; charset=utf-8")
    assert.deepEqual(itemTitles(res.body), ["Recente &amp; novo", "Antigo"])
    assert.match(res.body, /<link>https:\/\/blog.test\/posts\/slug\/recente<\/link>/)
  })

  it("limita aos 20 posts mais recentes", async () => {
    for (let day = 1; day <= 25; day++) {
      const date = `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`
      await seedPost({ title: `Dia ${day}`, approved_at: date, published_at: date })
    }

    const titles = itemTitles((await getFeed().expect(200)).body)

    assert.equal(titles.length, 20)
    assert.equal(titles[0], "Dia 25")
    assert.equal(titles.at(-1), "Dia 6")
  })

  it("responde um canal vazio quando não há posts publicados", async () => {
    const res = await getFeed().expect(200)

    assert.match(res.body, /<channel>/)
    assert.deepEqual(itemTitles(res.body), [])
  })
})
