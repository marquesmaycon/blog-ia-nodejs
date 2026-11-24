import assert from "node:assert/strict"
import { describe, it } from "node:test"

import request from "supertest"
import { z } from "zod"

import { createApp } from "../../../src/http/app.ts"
import { sendValidationError } from "../../../src/http/validation.ts"

const schema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string())
})

function buildServer(message?: string) {
  const app = createApp()
  app.post("/", (req, res) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, message)
    return res.send({ ok: true })
  })
  return app.server
}

describe("sendValidationError", () => {
  it("responde 400 com um erro por campo, com o caminho completo", async () => {
    const res = await request(buildServer())
      .post("/")
      .send({ name: "", tags: ["ok", 1] })

    assert.equal(res.status, 400)
    assert.deepEqual(res.body, {
      message: "Invalid request",
      errors: [
        { field: "name", message: "Too small: expected string to have >=1 characters" },
        { field: "tags.1", message: "Invalid input: expected string, received number" }
      ]
    })
  })

  it("usa field null quando o erro é no valor inteiro", async () => {
    const res = await request(buildServer("Invalid request body")).post("/")

    assert.deepEqual(res.body, {
      message: "Invalid request body",
      errors: [{ field: null, message: "Invalid input: expected object, received undefined" }]
    })
  })
})
