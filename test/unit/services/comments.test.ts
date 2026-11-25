// Testa as regras do service de comentários: os repositórios são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type { Comment, CommentStatus, NewComment } from "../../../src/repositories/comments.ts"
import type { Post } from "../../../src/repositories/posts.ts"

const approvedPost: Post = {
  id: "post-1",
  slug: "titulo",
  title: "Título",
  reading_time_minutes: 1,
  content: "Conteúdo",
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: "2026-01-01T00:00:00.000Z",
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: []
}

const comment: Comment = {
  id: "c-1",
  post_id: "post-1",
  author_name: "Ana",
  content: "Muito bom!",
  status: "pending",
  moderation_reason: null,
  created_at: "2026-01-02T00:00:00.000Z"
}

const commentsRepository = {
  findApprovedCommentsByPost: mock.fn(async (_postId: string): Promise<Comment[]> => [comment]),
  findCommentsByStatus: mock.fn(async (_status: CommentStatus): Promise<Comment[]> => [comment]),
  insertComment: mock.fn(async (data: NewComment): Promise<Comment> => ({ ...comment, ...data })),
  approveCommentById: mock.fn(async (_id: string): Promise<Comment | null> => comment),
  deleteCommentById: mock.fn(async (_id: string): Promise<boolean> => true)
}

const postsRepository = {
  findPostById: mock.fn(async (_id: string): Promise<Post | null> => approvedPost)
}

mock.module(import.meta.resolve("../../../src/repositories/comments.ts"), {
  exports: commentsRepository
})
mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: postsRepository })

const { approveComment, createComment, deleteComment, listCommentsByStatus, listPostComments } =
  await import("../../../src/services/comments.ts")

const unpublishedPosts: [string, Post | null][] = [
  ["inexistente", null],
  ["rascunho", { ...approvedPost, approved_at: null }],
  ["reprovado", { ...approvedPost, approved_at: null, rejected_at: "2026-01-03T00:00:00.000Z" }]
]

describe("services/comments", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(commentsRepository), postsRepository.findPostById]) {
      fn.mock.resetCalls()
    }
  })

  describe("listPostComments", () => {
    it("lista os aprovados de um post aprovado", async () => {
      const result = await listPostComments("post-1")

      assert.deepEqual(result, [comment])
      assert.deepEqual(postsRepository.findPostById.mock.calls[0].arguments, ["post-1"])
      assert.deepEqual(commentsRepository.findApprovedCommentsByPost.mock.calls[0].arguments, [
        "post-1"
      ])
    })

    for (const [name, post] of unpublishedPosts) {
      it(`retorna null para post ${name}`, async () => {
        postsRepository.findPostById.mock.mockImplementationOnce(async () => post)

        assert.equal(await listPostComments("post-1"), null)
        assert.equal(commentsRepository.findApprovedCommentsByPost.mock.callCount(), 0)
      })
    }
  })

  describe("createComment", () => {
    it("persiste o comentário em post aprovado", async () => {
      const result = await createComment("post-1", { author_name: "Bia", content: "Oi" })

      assert.deepEqual(commentsRepository.insertComment.mock.calls[0].arguments, [
        { post_id: "post-1", author_name: "Bia", content: "Oi" }
      ])
      assert.equal(result?.author_name, "Bia")
    })

    for (const [name, post] of unpublishedPosts) {
      it(`retorna null e não persiste para post ${name}`, async () => {
        postsRepository.findPostById.mock.mockImplementationOnce(async () => post)

        assert.equal(await createComment("post-1", { author_name: "Bia", content: "Oi" }), null)
        assert.equal(commentsRepository.insertComment.mock.callCount(), 0)
      })
    }
  })

  describe("operações administrativas", () => {
    it("delegam ao repositório", async () => {
      await listCommentsByStatus("rejected")
      await approveComment("c-1")
      assert.equal(await deleteComment("c-2"), true)

      assert.deepEqual(commentsRepository.findCommentsByStatus.mock.calls[0].arguments, [
        "rejected"
      ])
      assert.deepEqual(commentsRepository.approveCommentById.mock.calls[0].arguments, ["c-1"])
      assert.deepEqual(commentsRepository.deleteCommentById.mock.calls[0].arguments, ["c-2"])
    })
  })
})
