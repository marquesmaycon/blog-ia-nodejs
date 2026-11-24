// Testa o repositório de tags contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import { findPostById } from "../../../src/repositories/posts.ts"
import {
  deleteTagBySlug,
  findTagsWithApprovedPosts,
  replacePostTags
} from "../../../src/repositories/tags.ts"
import { pool, seedPost, seedPostTag, seedTag, truncatePosts } from "../../helpers/db.ts"

const APPROVED = { approved_at: "2026-01-01T00:00:00.000Z" }

const NODE = { name: "Node.js", slug: "node-js" }
const IA = { name: "IA", slug: "ia" }
const TS = { name: "TypeScript", slug: "typescript" }

const tagsOf = async (postId: string) => (await findPostById(postId))?.tags

const countTags = async () =>
  (await pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM tags")).rows[0].count

describe("repositories/tags", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  describe("replacePostTags", () => {
    it("cria as tags novas e associa ao post", async () => {
      const post = await seedPost()

      await replacePostTags(post.id, [NODE, IA])

      // Ordenadas pelo nome
      assert.deepEqual(await tagsOf(post.id), [IA, NODE])
      assert.equal(await countTags(), 2)
    })

    it("reaproveita a tag existente pelo slug, mantendo o nome cadastrado", async () => {
      const first = await seedPost()
      const second = await seedPost()
      await replacePostTags(first.id, [NODE])

      await replacePostTags(second.id, [{ name: "node js", slug: "node-js" }])

      assert.deepEqual(await tagsOf(second.id), [NODE])
      assert.equal(await countTags(), 1)
    })

    it("substitui o conjunto anterior", async () => {
      const post = await seedPost()
      await replacePostTags(post.id, [NODE, IA])

      await replacePostTags(post.id, [IA, TS])

      assert.deepEqual(await tagsOf(post.id), [IA, TS])
    })

    it("lista vazia remove todas as tags do post, mas mantém as tags", async () => {
      const post = await seedPost()
      await replacePostTags(post.id, [NODE])

      await replacePostTags(post.id, [])

      assert.deepEqual(await tagsOf(post.id), [])
      assert.equal(await countTags(), 1)
    })

    it("não mexe nas tags de outros posts", async () => {
      const post = await seedPost()
      const other = await seedPost()
      await replacePostTags(other.id, [NODE])

      await replacePostTags(post.id, [IA])

      assert.deepEqual(await tagsOf(other.id), [NODE])
    })

    it("desfaz tudo quando um passo falha (transação)", async () => {
      const post = await seedPost()
      await replacePostTags(post.id, [NODE])

      // Slug repetido no mesmo comando faz o ON CONFLICT DO UPDATE falhar
      await assert.rejects(replacePostTags(post.id, [IA, { name: "Ia", slug: "ia" }]))

      assert.deepEqual(await tagsOf(post.id), [NODE])
      assert.equal(await countTags(), 1)
    })
  })

  describe("findTagsWithApprovedPosts", () => {
    it("conta só posts aprovados e ordena por contagem e depois por nome", async () => {
      const [a, b] = await Promise.all([seedPost(APPROVED), seedPost(APPROVED)])
      const draft = await seedPost()
      const node = await seedTag(NODE)
      const ia = await seedTag(IA)
      const ts = await seedTag(TS)

      for (const post of [a, b, draft]) await seedPostTag({ post_id: post.id, tag_id: node.id })
      await seedPostTag({ post_id: a.id, tag_id: ts.id })
      await seedPostTag({ post_id: b.id, tag_id: ia.id })

      assert.deepEqual(await findTagsWithApprovedPosts(), [
        { ...NODE, posts_count: 2 },
        { ...IA, posts_count: 1 },
        { ...TS, posts_count: 1 }
      ])
    })

    it("ignora tags sem posts aprovados", async () => {
      const draft = await seedPost()
      const node = await seedTag(NODE)
      await seedTag(IA)
      await seedPostTag({ post_id: draft.id, tag_id: node.id })

      assert.deepEqual(await findTagsWithApprovedPosts(), [])
    })
  })

  describe("deleteTagBySlug", () => {
    it("apaga a tag e a remove dos posts", async () => {
      const post = await seedPost()
      await replacePostTags(post.id, [NODE, IA])

      assert.equal(await deleteTagBySlug("node-js"), true)

      assert.deepEqual(await tagsOf(post.id), [IA])
    })

    it("retorna false quando a tag não existe", async () => {
      assert.equal(await deleteTagBySlug("missing"), false)
    })
  })
})
