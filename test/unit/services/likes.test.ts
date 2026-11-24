// Testa as regras do service de curtidas: os repositórios são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type { PopularPost, Post } from "../../../src/repositories/posts.ts"

const approvedPost: Post = {
  id: "post-1",
  title: "Título",
  content: "Conteúdo",
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: "2026-01-01T00:00:00.000Z",
  rejected_at: null,
  likes_count: 0,
  comments_count: 0
}

const popular: PopularPost = { ...approvedPost, likes_count: 3, recent_likes: 2 }

const likesRepository = {
  insertLike: mock.fn(async (_postId: string, _visitorId: string): Promise<boolean> => true),
  deleteLike: mock.fn(async (_postId: string, _visitorId: string): Promise<boolean> => true),
  countLikesByPost: mock.fn(async (_postId: string): Promise<number> => 3)
}

const postsRepository = {
  findPostById: mock.fn(async (_id: string): Promise<Post | null> => approvedPost),
  findPopularPosts: mock.fn(
    async (_query: { days: number; limit: number }): Promise<PopularPost[]> => [popular]
  )
}

mock.module(import.meta.resolve("../../../src/repositories/likes.ts"), { exports: likesRepository })
mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: postsRepository })

const { likePost, listPopularPosts, unlikePost } = await import("../../../src/services/likes.ts")

const unpublishedPosts: [string, Post | null][] = [
  ["inexistente", null],
  ["rascunho", { ...approvedPost, approved_at: null }],
  ["reprovado", { ...approvedPost, approved_at: null, rejected_at: "2026-01-02T00:00:00.000Z" }]
]

describe("services/likes", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(likesRepository), ...Object.values(postsRepository)]) {
      fn.mock.resetCalls()
    }
    postsRepository.findPostById.mock.mockImplementation(async () => approvedPost)
    likesRepository.insertLike.mock.mockImplementation(async () => true)
  })

  describe("likePost", () => {
    it("registra a curtida e devolve o total atualizado", async () => {
      const result = await likePost("post-1", "visitor-1")

      assert.deepEqual(result, { created: true, likes_count: 3 })
      assert.deepEqual(postsRepository.findPostById.mock.calls[0].arguments, ["post-1"])
      assert.deepEqual(likesRepository.insertLike.mock.calls[0].arguments, ["post-1", "visitor-1"])
      assert.deepEqual(likesRepository.countLikesByPost.mock.calls[0].arguments, ["post-1"])
    })

    it("sinaliza created=false quando o visitante já tinha curtido", async () => {
      likesRepository.insertLike.mock.mockImplementation(async () => false)

      assert.deepEqual(await likePost("post-1", "visitor-1"), { created: false, likes_count: 3 })
    })

    for (const [label, post] of unpublishedPosts) {
      it(`retorna null para post ${label}, sem gravar nada`, async () => {
        postsRepository.findPostById.mock.mockImplementation(async () => post)

        assert.equal(await likePost("post-1", "visitor-1"), null)
        assert.equal(likesRepository.insertLike.mock.callCount(), 0)
      })
    }
  })

  describe("unlikePost", () => {
    it("remove a curtida e devolve o total atualizado", async () => {
      const result = await unlikePost("post-1", "visitor-1")

      assert.deepEqual(result, { likes_count: 3 })
      assert.deepEqual(likesRepository.deleteLike.mock.calls[0].arguments, ["post-1", "visitor-1"])
    })

    for (const [label, post] of unpublishedPosts) {
      it(`retorna null para post ${label}, sem apagar nada`, async () => {
        postsRepository.findPostById.mock.mockImplementation(async () => post)

        assert.equal(await unlikePost("post-1", "visitor-1"), null)
        assert.equal(likesRepository.deleteLike.mock.callCount(), 0)
      })
    }
  })

  describe("listPopularPosts", () => {
    it("repassa a janela e o limite ao repositório", async () => {
      assert.deepEqual(await listPopularPosts({ days: 30, limit: 5 }), [popular])
      assert.deepEqual(postsRepository.findPopularPosts.mock.calls[0].arguments, [
        { days: 30, limit: 5 }
      ])
    })
  })
})
