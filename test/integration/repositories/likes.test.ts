// Testa o repositório de curtidas contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import { countLikesByPost, deleteLike, insertLike } from "../../../src/repositories/likes.ts"
import { pool, seedPost, truncatePosts } from "../../helpers/db.ts"

describe("repositories/likes", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  describe("insertLike", () => {
    it("registra a curtida e retorna true", async () => {
      const post = await seedPost()

      assert.equal(await insertLike(post.id, "visitor-1"), true)
      assert.equal(await countLikesByPost(post.id), 1)
    })

    it("é idempotente por visitante: a segunda curtida retorna false e não duplica", async () => {
      const post = await seedPost()

      await insertLike(post.id, "visitor-1")

      assert.equal(await insertLike(post.id, "visitor-1"), false)
      assert.equal(await countLikesByPost(post.id), 1)
    })

    it("conta visitantes diferentes separadamente e isola os posts", async () => {
      const post = await seedPost()
      const other = await seedPost()

      await insertLike(post.id, "visitor-1")
      await insertLike(post.id, "visitor-2")
      await insertLike(other.id, "visitor-1")

      assert.equal(await countLikesByPost(post.id), 2)
      assert.equal(await countLikesByPost(other.id), 1)
    })
  })

  describe("deleteLike", () => {
    it("remove a curtida do visitante e retorna true", async () => {
      const post = await seedPost()
      await insertLike(post.id, "visitor-1")
      await insertLike(post.id, "visitor-2")

      assert.equal(await deleteLike(post.id, "visitor-1"), true)
      assert.equal(await countLikesByPost(post.id), 1)
    })

    it("retorna false quando não havia curtida", async () => {
      const post = await seedPost()

      assert.equal(await deleteLike(post.id, "visitor-1"), false)
    })
  })

  describe("countLikesByPost", () => {
    it("retorna 0 (número, não string) sem curtidas", async () => {
      const post = await seedPost()

      assert.equal(await countLikesByPost(post.id), 0)
    })
  })

  it("apaga as curtidas junto com o post (ON DELETE CASCADE)", async () => {
    const post = await seedPost()
    await insertLike(post.id, "visitor-1")

    await pool.query("DELETE FROM posts WHERE id = $1", [post.id])

    const { rowCount } = await pool.query("SELECT 1 FROM post_likes WHERE post_id = $1", [post.id])
    assert.equal(rowCount, 0)
  })
})
