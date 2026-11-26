// Testa o repositório de revisões de posts contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import {
  findPostReviews,
  insertPostReviews,
  insertPostWithReviews,
  type NewPostReview
} from "../../../src/repositories/post-reviews.ts"
import { findPostById, type NewPost } from "../../../src/repositories/posts.ts"
import { pool, seedPost, seedPostReview, truncatePosts } from "../../helpers/db.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const newPost: NewPost = {
  title: "Streams no Node",
  content: "## Streams",
  slug: "streams-no-node",
  reading_time_minutes: 1
}

const reviews: NewPostReview[] = [
  { attempt: 1, score: 5, issues: ["sem exemplo", "título longo"], suggestions: ["adicione"] },
  { attempt: 2, score: 8, issues: [], suggestions: [] }
]

describe("repositories/post-reviews", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  describe("insertPostReviews", () => {
    it("persiste uma linha por revisão, com arrays, id gerado e data em ISO", async () => {
      const post = await seedPost()

      const saved = await insertPostReviews(pool, post.id, reviews)

      assert.equal(saved.length, 2)
      assert.deepEqual(
        saved.map(({ attempt, score, issues, suggestions }) => ({
          attempt,
          score,
          issues,
          suggestions
        })),
        reviews
      )
      for (const review of saved) {
        assert.ok(review.id.length > 0)
        assert.equal(review.post_id, post.id)
        assert.match(review.created_at, ISO_DATE)
      }
    })

    it("não faz nada com a lista vazia", async () => {
      const post = await seedPost()

      assert.deepEqual(await insertPostReviews(pool, post.id, []), [])
      assert.deepEqual(await findPostReviews(post.id), [])
    })

    it("rejeita nota fora de 0 a 10", async () => {
      const post = await seedPost()

      await assert.rejects(
        insertPostReviews(pool, post.id, [{ attempt: 1, score: 11, issues: [], suggestions: [] }]),
        { code: "23514" }
      )
    })

    it("rejeita tentativa repetida no mesmo post", async () => {
      const post = await seedPost()
      await seedPostReview({ post_id: post.id, attempt: 1 })

      await assert.rejects(insertPostReviews(pool, post.id, [reviews[0]]), { code: "23505" })
    })
  })

  describe("insertPostWithReviews", () => {
    it("grava o post e as revisões juntos", async () => {
      const { post, reviews: saved } = await insertPostWithReviews(newPost, reviews)

      assert.equal(post.slug, "streams-no-node")
      assert.ok(await findPostById(post.id))
      assert.deepEqual(
        saved.map((review) => review.attempt),
        [1, 2]
      )
      assert.deepEqual(await findPostReviews(post.id), saved)
    })

    it("desfaz o post quando as revisões falham", async () => {
      const invalid = [{ attempt: 1, score: -1, issues: [], suggestions: [] }]

      await assert.rejects(insertPostWithReviews(newPost, invalid), { code: "23514" })

      const { rows } = await pool.query("SELECT id FROM posts WHERE slug = $1", [newPost.slug])
      assert.deepEqual(rows, [])
    })

    it("propaga a colisão de slug para o service tentar de novo", async () => {
      await seedPost({ slug: newPost.slug })

      await assert.rejects(insertPostWithReviews(newPost, reviews), {
        code: "23505",
        constraint: "posts_slug_key"
      })
    })
  })

  describe("findPostReviews", () => {
    it("ordena pela tentativa e só traz as do post", async () => {
      const post = await seedPost()
      const other = await seedPost()
      await seedPostReview({ post_id: post.id, attempt: 2, score: 9 })
      await seedPostReview({ post_id: post.id, attempt: 1, score: 4 })
      await seedPostReview({ post_id: other.id, attempt: 1 })

      const found = await findPostReviews(post.id)

      assert.deepEqual(
        found.map((review) => [review.attempt, review.score]),
        [
          [1, 4],
          [2, 9]
        ]
      )
    })

    it("apaga as revisões junto com o post (ON DELETE CASCADE)", async () => {
      const post = await seedPost()
      await seedPostReview({ post_id: post.id })

      await pool.query("DELETE FROM posts WHERE id = $1", [post.id])

      assert.deepEqual(await findPostReviews(post.id), [])
    })
  })
})
