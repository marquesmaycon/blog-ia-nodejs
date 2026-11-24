// Testa as regras do service de tags: os repositórios são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type { Post, PostTag } from "../../../src/repositories/posts.ts"
import type { TagWithCount } from "../../../src/repositories/tags.ts"

const post: Post = {
  id: "post-1",
  title: "Título",
  content: "Conteúdo",
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: null,
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: []
}

const tagged: Post = { ...post, tags: [{ name: "Node.js", slug: "node-js" }] }
const tagWithCount: TagWithCount = { name: "Node.js", slug: "node-js", posts_count: 2 }

const postsRepository = {
  findPostById: mock.fn(async (_id: string): Promise<Post | null> => post)
}

const tagsRepository = {
  replacePostTags: mock.fn(async (_postId: string, _tags: PostTag[]): Promise<void> => {}),
  findTagsWithApprovedPosts: mock.fn(async (): Promise<TagWithCount[]> => [tagWithCount]),
  deleteTagBySlug: mock.fn(async (_slug: string): Promise<boolean> => true)
}

mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: postsRepository })
mock.module(import.meta.resolve("../../../src/repositories/tags.ts"), { exports: tagsRepository })

const { deleteTag, listTags, setPostTags } = await import("../../../src/services/tags.ts")

describe("services/tags", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(postsRepository), ...Object.values(tagsRepository)]) {
      fn.mock.resetCalls()
    }
    postsRepository.findPostById.mock.mockImplementation(async () => post)
  })

  describe("setPostTags", () => {
    it("gera os slugs, substitui as tags e devolve o post atualizado", async () => {
      postsRepository.findPostById.mock.mockImplementation(async () => tagged)

      const result = await setPostTags("post-1", ["Node.js", "Programação"])

      assert.deepEqual(result, tagged)
      assert.deepEqual(tagsRepository.replacePostTags.mock.calls[0].arguments, [
        "post-1",
        [
          { name: "Node.js", slug: "node-js" },
          { name: "Programação", slug: "programacao" }
        ]
      ])
    })

    it("deduplica por slug, mantendo o primeiro nome", async () => {
      await setPostTags("post-1", ["Node.js", "node js", "NODE-JS", "IA"])

      assert.deepEqual(tagsRepository.replacePostTags.mock.calls[0].arguments[1], [
        { name: "Node.js", slug: "node-js" },
        { name: "IA", slug: "ia" }
      ])
    })

    it("lista vazia remove todas as tags", async () => {
      await setPostTags("post-1", [])

      assert.deepEqual(tagsRepository.replacePostTags.mock.calls[0].arguments, ["post-1", []])
    })

    it("retorna null quando o post não existe, sem gravar nada", async () => {
      postsRepository.findPostById.mock.mockImplementation(async () => null)

      assert.equal(await setPostTags("missing", ["IA"]), null)
      assert.equal(tagsRepository.replacePostTags.mock.callCount(), 0)
    })
  })

  describe("listTags / deleteTag", () => {
    it("listTags delega ao repositório", async () => {
      assert.deepEqual(await listTags(), [tagWithCount])
    })

    it("deleteTag repassa o slug e o resultado", async () => {
      tagsRepository.deleteTagBySlug.mock.mockImplementationOnce(async () => false)

      assert.equal(await deleteTag("node-js"), false)
      assert.deepEqual(tagsRepository.deleteTagBySlug.mock.calls[0].arguments, ["node-js"])
    })
  })
})
