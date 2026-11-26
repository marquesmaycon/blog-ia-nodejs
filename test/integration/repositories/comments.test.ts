// Testa o repositório de comentários contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import {
  approveCommentById,
  deleteCommentById,
  findApprovedCommentsByPost,
  findCommentById,
  findCommentsByStatus,
  hasAiReply,
  insertComment
} from "../../../src/repositories/comments.ts"
import type { Post } from "../../../src/repositories/posts.ts"
import { pool, seedComment, seedPost, truncatePosts } from "../../helpers/db.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe("repositories/comments", () => {
  let post: Post

  beforeEach(async () => {
    await truncatePosts()
    post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
  })
  after(() => pool.end())

  describe("insertComment", () => {
    it("persiste o comentário como pendente, com id gerado e data em ISO", async () => {
      const comment = await insertComment({
        post_id: post.id,
        author_name: "Ana",
        content: "Muito bom!"
      })

      assert.ok(comment.id.length > 0)
      assert.equal(comment.post_id, post.id)
      assert.equal(comment.author_name, "Ana")
      assert.equal(comment.content, "Muito bom!")
      assert.equal(comment.status, "pending")
      assert.equal(comment.moderation_reason, null)
      assert.deepEqual(comment.moderation_categories, [])
      assert.equal(comment.parent_id, null)
      assert.equal(comment.author_type, "reader")
      assert.match(comment.created_at, ISO_DATE)
    })

    it("persiste a resposta da IA com parent_id e author_type", async () => {
      const parent = await seedComment({ post_id: post.id, status: "approved" })

      const reply = await insertComment({
        post_id: post.id,
        parent_id: parent.id,
        author_type: "ai",
        author_name: "Autor do blog (IA)",
        content: "Resposta"
      })

      assert.equal(reply.parent_id, parent.id)
      assert.equal(reply.author_type, "ai")
      assert.equal(reply.status, "pending")
    })

    it("aceita só um rascunho da IA por comentário (unique index)", async () => {
      const parent = await seedComment({ post_id: post.id, status: "approved" })
      const reply = { post_id: post.id, parent_id: parent.id, author_name: "IA", content: "Oi" }

      await insertComment({ ...reply, author_type: "ai" })

      await assert.rejects(insertComment({ ...reply, author_type: "ai" }), {
        code: "23505",
        constraint: "comments_ai_reply_per_parent_idx"
      })
      // A restrição vale só para a IA
      await insertComment(reply)
    })

    it("rejeita author_type desconhecido (CHECK)", async () => {
      await assert.rejects(
        pool.query(
          `INSERT INTO comments (id, post_id, author_name, content, author_type)
           VALUES ('x', $1, 'Ana', 'Oi', 'admin')`,
          [post.id]
        ),
        /check constraint/
      )
    })

    it("persiste o veredito da moderação quando informado", async () => {
      const comment = await insertComment({
        post_id: post.id,
        author_name: "Spammer",
        content: "Compre já",
        status: "rejected",
        moderation_reason: "Propaganda",
        moderation_categories: ["spam", "self-promotion"]
      })

      assert.equal(comment.status, "rejected")
      assert.equal(comment.moderation_reason, "Propaganda")
      assert.deepEqual(comment.moderation_categories, ["spam", "self-promotion"])

      const { rows } = await pool.query(
        "SELECT status, moderation_reason, moderation_categories FROM comments WHERE id = $1",
        [comment.id]
      )
      assert.deepEqual(rows[0], {
        status: "rejected",
        moderation_reason: "Propaganda",
        moderation_categories: ["spam", "self-promotion"]
      })
    })

    it("rejeita post inexistente (FK)", async () => {
      await assert.rejects(
        insertComment({ post_id: "missing", author_name: "Ana", content: "Oi" }),
        /foreign key/
      )
    })
  })

  describe("findCommentById", () => {
    it("retorna o comentário ou null", async () => {
      const seeded = await seedComment({ post_id: post.id })

      assert.deepEqual(await findCommentById(seeded.id), seeded)
      assert.equal(await findCommentById("missing"), null)
    })
  })

  describe("hasAiReply", () => {
    it("só considera as respostas da IA ao comentário informado", async () => {
      const parent = await seedComment({ post_id: post.id, status: "approved" })
      const other = await seedComment({ post_id: post.id, status: "approved" })
      await seedComment({ post_id: post.id, parent_id: other.id, author_type: "reader" })

      assert.equal(await hasAiReply(parent.id), false)
      assert.equal(await hasAiReply(other.id), false)

      await seedComment({ post_id: post.id, parent_id: parent.id, author_type: "ai" })

      assert.equal(await hasAiReply(parent.id), true)
    })
  })

  describe("findApprovedCommentsByPost", () => {
    it("retorna só os aprovados do post, do mais antigo para o mais recente", async () => {
      const other = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      const newer = await seedComment({
        post_id: post.id,
        status: "approved",
        created_at: "2026-02-02T00:00:00.000Z"
      })
      const older = await seedComment({
        post_id: post.id,
        status: "approved",
        created_at: "2026-02-01T00:00:00.000Z"
      })
      await seedComment({ post_id: post.id, status: "pending" })
      await seedComment({ post_id: post.id, status: "rejected" })
      await seedComment({ post_id: other.id, status: "approved" })

      const comments = await findApprovedCommentsByPost(post.id)

      assert.deepEqual(
        comments.map((comment) => comment.id),
        [older.id, newer.id]
      )
    })
  })

  describe("findCommentsByStatus", () => {
    it("filtra pelo status em todos os posts, do mais antigo para o mais recente", async () => {
      const other = await seedPost()
      const second = await seedComment({
        post_id: other.id,
        created_at: "2026-02-02T00:00:00.000Z"
      })
      const first = await seedComment({ post_id: post.id, created_at: "2026-02-01T00:00:00.000Z" })
      await seedComment({ post_id: post.id, status: "approved" })

      const pending = await findCommentsByStatus("pending")

      assert.deepEqual(
        pending.map((comment) => comment.id),
        [first.id, second.id]
      )
      assert.equal((await findCommentsByStatus("rejected")).length, 0)
    })
  })

  describe("approveCommentById", () => {
    it("aprova e limpa moderation_reason e moderation_categories", async () => {
      const seeded = await seedComment({
        post_id: post.id,
        status: "rejected",
        moderation_reason: "spam",
        moderation_categories: ["spam"]
      })

      const approved = await approveCommentById(seeded.id)

      assert.ok(approved)
      assert.equal(approved.status, "approved")
      assert.equal(approved.moderation_reason, null)
      assert.deepEqual(approved.moderation_categories, [])
    })

    it("retorna null quando o comentário não existe", async () => {
      assert.equal(await approveCommentById("missing"), null)
    })
  })

  describe("deleteCommentById", () => {
    it("apaga e retorna true", async () => {
      const seeded = await seedComment({ post_id: post.id })

      assert.equal(await deleteCommentById(seeded.id), true)
      assert.deepEqual(await findCommentsByStatus("pending"), [])
    })

    it("retorna false quando o comentário não existe", async () => {
      assert.equal(await deleteCommentById("missing"), false)
    })
  })

  it("apagar o comentário apaga a resposta (ON DELETE CASCADE)", async () => {
    const parent = await seedComment({ post_id: post.id, status: "approved" })
    const reply = await seedComment({ post_id: post.id, parent_id: parent.id, author_type: "ai" })

    await deleteCommentById(parent.id)

    assert.equal(await findCommentById(reply.id), null)
  })

  it("apagar o post apaga os comentários (ON DELETE CASCADE)", async () => {
    await seedComment({ post_id: post.id })

    await pool.query("DELETE FROM posts WHERE id = $1", [post.id])

    assert.deepEqual(await findCommentsByStatus("pending"), [])
  })
})
