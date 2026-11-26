import assert from "node:assert/strict"
import { describe, it } from "node:test"

import request from "supertest"

import { openApiSpec } from "../../../src/docs/openapi.ts"
import { createApp } from "../../../src/http/app.ts"
import { registerCommentRoutes } from "../../../src/routes/comments.ts"
import { registerDocsRoutes } from "../../../src/routes/docs.ts"
import { registerEditorialRoutes } from "../../../src/routes/editorial.ts"
import { registerFeedRoutes } from "../../../src/routes/feed.ts"
import { registerLikeRoutes } from "../../../src/routes/likes.ts"
import { registerPostRoutes } from "../../../src/routes/posts.ts"
import { registerTagRoutes } from "../../../src/routes/tags.ts"

function buildServer() {
  const app = createApp()
  registerDocsRoutes(app)
  return app.server
}

// As rotas da própria documentação não entram na spec
const UNDOCUMENTED_PATHS = new Set(["/api/docs", "/api/docs/json"])

// "GET /posts/{id}" para cada rota registrada, no formato de path do OpenAPI
function registeredOperations(): string[] {
  const app = createApp()
  registerDocsRoutes(app)
  registerPostRoutes(app)
  registerCommentRoutes(app)
  registerLikeRoutes(app)
  registerTagRoutes(app)
  registerFeedRoutes(app)
  registerEditorialRoutes(app)

  return app
    .routes()
    .filter((route) => !UNDOCUMENTED_PATHS.has(route.path))
    .map((route) => `${route.method} ${route.path.replace(/:(\w+)/g, "{$1}")}`)
    .toSorted()
}

function documentedOperations(): string[] {
  return Object.entries(openApiSpec.paths)
    .flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`)
    )
    .toSorted()
}

describe("rotas /api/docs", () => {
  it("GET /api/docs serve a Swagger UI apontando para a spec", async () => {
    const res = await request(buildServer()).get("/api/docs")

    assert.equal(res.status, 200)
    assert.match(res.headers["content-type"], /^text\/html/)
    assert.match(res.text, /SwaggerUIBundle/)
    assert.match(res.text, /\/api\/docs\/json/)
  })

  it("GET /api/docs/json retorna a spec OpenAPI", async () => {
    const res = await request(buildServer()).get("/api/docs/json")

    assert.equal(res.status, 200)
    assert.match(res.headers["content-type"], /^application\/json/)
    assert.equal(res.body.openapi, "3.1.0")
    assert.deepEqual(res.body, JSON.parse(JSON.stringify(openApiSpec)))
  })

  it("documenta todas as rotas registradas, e só elas", () => {
    assert.deepEqual(documentedOperations(), registeredOperations())
  })
})
