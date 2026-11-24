import assert from "node:assert/strict"
import { describe, it } from "node:test"

import request from "supertest"

import { createApp } from "../../../src/http/app.ts"
import { registerDocsRoutes } from "../../../src/routes/docs.ts"

function buildServer() {
  const app = createApp()
  registerDocsRoutes(app)
  return app.server
}

describe("rotas /api/docs", () => {
  it("GET /api/docs serve a Swagger UI apontando para a spec", async () => {
    const res = await request(buildServer()).get("/api/docs")

    assert.equal(res.status, 200)
    assert.match(res.headers["content-type"], /^text\/html/)
    assert.match(res.text, /SwaggerUIBundle/)
    assert.match(res.text, /\/api\/docs\/json/)
  })

  it("GET /api/docs/json retorna a spec OpenAPI com as rotas de posts, comentários, curtidas e tags", async () => {
    const res = await request(buildServer()).get("/api/docs/json")

    assert.equal(res.status, 200)
    assert.match(res.headers["content-type"], /^application\/json/)
    assert.equal(res.body.openapi, "3.1.0")
    assert.deepEqual(Object.keys(res.body.paths).toSorted(), [
      "/comments",
      "/comments/{id}",
      "/comments/{id}/approve",
      "/posts",
      "/posts/draft",
      "/posts/popular",
      "/posts/{id}",
      "/posts/{id}/approve",
      "/posts/{id}/comments",
      "/posts/{id}/likes",
      "/posts/{id}/reject",
      "/posts/{id}/tags",
      "/tags",
      "/tags/{slug}"
    ])
  })
})
