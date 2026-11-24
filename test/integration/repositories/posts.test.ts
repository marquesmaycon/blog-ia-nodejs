// Testa o repositório contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import {
  approvePostById,
  findAllPosts,
  findApprovedPosts,
  findPopularPosts,
  findPostById,
  insertPost,
  rejectPostById,
  type Post
} from "../../../src/repositories/posts.ts"
import { pool, seedComment, seedLike, seedPost, truncatePosts } from "../../helpers/db.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const APPROVED = { approved_at: "2026-01-01T00:00:00.000Z" }

const pickCounters = (post: Post | null) => ({
  likes_count: post?.likes_count,
  comments_count: post?.comments_count
})

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

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

  describe("contadores", () => {
    it("começam em 0 num post novo", async () => {
      const post = await insertPost({ title: "Título", content: "Conteúdo" })

      assert.equal(post.likes_count, 0)
      assert.equal(post.comments_count, 0)
    })

    it("contam curtidas e só os comentários aprovados, em todas as consultas", async () => {
      const post = await seedPost(APPROVED)
      await seedLike({ post_id: post.id })
      await seedLike({ post_id: post.id })
      await seedComment({ post_id: post.id, status: "approved" })
      await seedComment({ post_id: post.id, status: "pending" })
      await seedComment({ post_id: post.id, status: "rejected" })

      const expected = { likes_count: 2, comments_count: 1 }
      assert.deepEqual(pickCounters(await findPostById(post.id)), expected)
      assert.deepEqual(pickCounters((await findAllPosts())[0]), expected)
      assert.deepEqual(pickCounters((await findApprovedPosts())[0]), expected)
      assert.deepEqual(pickCounters(await rejectPostById(post.id)), expected)
      assert.deepEqual(pickCounters(await approvePostById(post.id)), expected)
    })
  })

  describe("findPopularPosts", () => {
    it("ordena pelas curtidas na janela e desempata pelo mais recente", async () => {
      const top = await seedPost({ ...APPROVED, published_at: "2026-01-01T00:00:00.000Z" })
      const tiedOlder = await seedPost({ ...APPROVED, published_at: "2026-01-02T00:00:00.000Z" })
      const tiedNewer = await seedPost({ ...APPROVED, published_at: "2026-01-03T00:00:00.000Z" })

      for (const visitor_id of ["a", "b", "c"]) await seedLike({ post_id: top.id, visitor_id })
      await seedLike({ post_id: tiedOlder.id })
      await seedLike({ post_id: tiedNewer.id })

      const posts = await findPopularPosts({ days: 7, limit: 10 })

      assert.deepEqual(
        posts.map((post) => [post.id, post.recent_likes]),
        [
          [top.id, 3],
          [tiedNewer.id, 1],
          [tiedOlder.id, 1]
        ]
      )
      assert.equal(posts[0].likes_count, 3)
    })

    it("conta só as curtidas dentro da janela, mas likes_count traz o total", async () => {
      const post = await seedPost(APPROVED)
      const stale = await seedPost(APPROVED)
      await seedLike({ post_id: post.id, created_at: daysAgo(1) })
      await seedLike({ post_id: post.id, created_at: daysAgo(10) })
      await seedLike({ post_id: stale.id, created_at: daysAgo(10) })

      const posts = await findPopularPosts({ days: 7, limit: 10 })

      assert.equal(posts.length, 1)
      assert.equal(posts[0].id, post.id)
      assert.equal(posts[0].recent_likes, 1)
      assert.equal(posts[0].likes_count, 2)
    })

    it("ignora posts não aprovados e respeita o limite", async () => {
      const draft = await seedPost()
      const rejected = await seedPost({ rejected_at: "2026-01-01T00:00:00.000Z" })
      const approved = await Promise.all([1, 2, 3].map(() => seedPost(APPROVED)))

      for (const post of [draft, rejected, ...approved]) await seedLike({ post_id: post.id })

      const posts = await findPopularPosts({ days: 7, limit: 2 })

      assert.equal(posts.length, 2)
      for (const post of posts) assert.ok(approved.some((a) => a.id === post.id))
    })

    it("retorna lista vazia sem curtidas", async () => {
      await seedPost(APPROVED)

      assert.deepEqual(await findPopularPosts({ days: 7, limit: 10 }), [])
    })
  })
})
