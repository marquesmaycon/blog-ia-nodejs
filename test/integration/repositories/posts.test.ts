// Testa o repositório contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import {
  approvePostById,
  findAllPosts,
  findApprovedPosts,
  findPostById,
  insertPost,
  rejectPostById
} from "../../../src/repositories/posts.ts"
import { pool, seedPost, truncatePosts } from "../../helpers/db.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe("repositories/posts", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  describe("insertPost", () => {
    it("persiste o post como rascunho, com id gerado e datas em ISO", async () => {
      const post = await insertPost({ title: "Título", content: "Conteúdo" })

      assert.equal(typeof post.id, "string")
      assert.ok(post.id.length > 0)
      assert.equal(post.title, "Título")
      assert.equal(post.content, "Conteúdo")
      assert.match(post.published_at, ISO_DATE)
      assert.equal(post.approved_at, null)
      assert.equal(post.rejected_at, null)

      assert.deepEqual(await findPostById(post.id), post)
    })

    it("gera ids diferentes a cada inserção", async () => {
      const a = await insertPost({ title: "A", content: "A" })
      const b = await insertPost({ title: "B", content: "B" })

      assert.notEqual(a.id, b.id)
    })
  })

  describe("findPostById", () => {
    it("retorna null quando o post não existe", async () => {
      assert.equal(await findPostById("missing"), null)
    })
  })

  describe("findAllPosts / findApprovedPosts", () => {
    it("findAllPosts retorna todos, do mais recente para o mais antigo", async () => {
      const older = await seedPost({ published_at: "2026-01-01T00:00:00.000Z" })
      const newer = await seedPost({
        published_at: "2026-02-01T00:00:00.000Z",
        approved_at: "2026-02-01T00:00:00.000Z"
      })

      const posts = await findAllPosts()

      assert.deepEqual(
        posts.map((post) => post.id),
        [newer.id, older.id]
      )
    })

    it("findApprovedPosts retorna apenas aprovados, ordenados", async () => {
      await seedPost({ title: "rascunho" })
      await seedPost({ title: "reprovado", rejected_at: "2026-01-01T00:00:00.000Z" })
      const older = await seedPost({
        published_at: "2026-01-01T00:00:00.000Z",
        approved_at: "2026-01-01T00:00:00.000Z"
      })
      const newer = await seedPost({
        published_at: "2026-02-01T00:00:00.000Z",
        approved_at: "2026-02-01T00:00:00.000Z"
      })

      const posts = await findApprovedPosts()

      assert.deepEqual(
        posts.map((post) => post.id),
        [newer.id, older.id]
      )
    })

    it("retornam lista vazia sem posts", async () => {
      assert.deepEqual(await findAllPosts(), [])
      assert.deepEqual(await findApprovedPosts(), [])
    })
  })

  describe("approvePostById", () => {
    it("aprova, atualiza published_at e limpa rejected_at", async () => {
      const seeded = await seedPost({
        published_at: "2020-01-01T00:00:00.000Z",
        rejected_at: "2020-01-02T00:00:00.000Z"
      })

      const approved = await approvePostById(seeded.id)

      assert.ok(approved)
      assert.match(approved.approved_at ?? "", ISO_DATE)
      assert.equal(approved.rejected_at, null)
      assert.ok(approved.published_at > seeded.published_at)
      assert.equal(approved.published_at, approved.approved_at)
    })

    it("retorna null quando o post não existe", async () => {
      assert.equal(await approvePostById("missing"), null)
    })
  })

  describe("rejectPostById", () => {
    it("reprova e limpa approved_at, mantendo published_at", async () => {
      const seeded = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

      const rejected = await rejectPostById(seeded.id)

      assert.ok(rejected)
      assert.match(rejected.rejected_at ?? "", ISO_DATE)
      assert.equal(rejected.approved_at, null)
      assert.equal(rejected.published_at, seeded.published_at)
    })

    it("retorna null quando o post não existe", async () => {
      assert.equal(await rejectPostById("missing"), null)
    })
  })
})
