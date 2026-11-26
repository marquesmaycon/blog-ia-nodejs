// Testa as regras do rascunho de resposta da IA: Mastra, repositório e visibilidade do post
// são substituídos por mocks. Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import type { Comment, NewComment } from "../../../src/repositories/comments.ts"
import type { Post } from "../../../src/repositories/posts.ts"

type GenerateOptions = { structuredOutput: { schema: unknown }; abortSignal: AbortSignal }

const answer = {
  is_question: true,
  answerable: true,
  reply: "  Use `pipeline` para propagar os erros.  ",
  reason: "O post explica pipeline"
}

const generate = mock.fn(async (_prompt: string, _options: GenerateOptions): Promise<unknown> => ({
  object: answer
}))
const getAgent = mock.fn((_id: string) => ({ generate }))

const post: Post = {
  id: "post-1",
  slug: "streams",
  title: "Streams no Node.js",
  reading_time_minutes: 1,
  content: "## Introdução\n\nStreams são...",
  summary: null,
  meta_description: null,
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: "2026-01-01T00:00:00.000Z",
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: []
}

const question: Comment = {
  id: "c-1",
  post_id: "post-1",
  author_name: "Ana",
  content: "Como trato erros em streams?",
  status: "approved",
  moderation_reason: null,
  moderation_categories: [],
  parent_id: null,
  author_type: "reader",
  created_at: "2026-01-02T00:00:00.000Z"
}

const repository = {
  findCommentById: mock.fn(async (_id: string): Promise<Comment | null> => question),
  hasAiReply: mock.fn(async (_parentId: string): Promise<boolean> => false),
  insertComment: mock.fn(
    async (data: NewComment): Promise<Comment> => ({ ...question, id: "r-1", ...data }) as Comment
  )
}

const visibility = {
  findPublishedPost: mock.fn(async (_postId: string): Promise<Post | null> => post)
}

mock.module(import.meta.resolve("../../../src/mastra/index.ts"), {
  exports: { mastra: { getAgent } }
})
mock.module(import.meta.resolve("../../../src/mastra/agents/comment-replier.ts"), {
  exports: { COMMENT_REPLIER_AGENT_ID: "comment-replier" }
})
mock.module(import.meta.resolve("../../../src/repositories/comments.ts"), { exports: repository })
mock.module(import.meta.resolve("../../../src/services/post-visibility.ts"), {
  exports: visibility
})

const { draftCommentReply, REPLY_AUTHOR_NAME } =
  await import("../../../src/services/comment-replies.ts")

const respond = (object: unknown) => async () => ({ object })

describe("services/comment-replies", () => {
  const originalTimeout = process.env.COMMENT_REPLY_TIMEOUT_MS
  let consoleError: ReturnType<typeof mock.method>

  beforeEach(() => {
    for (const fn of [
      generate,
      getAgent,
      ...Object.values(repository),
      visibility.findPublishedPost
    ]) {
      fn.mock.resetCalls()
    }
    consoleError = mock.method(console, "error", () => {})
  })

  afterEach(() => {
    mock.restoreAll()
    if (originalTimeout === undefined) delete process.env.COMMENT_REPLY_TIMEOUT_MS
    else process.env.COMMENT_REPLY_TIMEOUT_MS = originalTimeout
  })

  it("grava a resposta como rascunho da IA, filha do comentário", async () => {
    const result = await draftCommentReply("c-1")

    assert.deepEqual(repository.insertComment.mock.calls[0].arguments, [
      {
        post_id: "post-1",
        parent_id: "c-1",
        author_type: "ai",
        author_name: REPLY_AUTHOR_NAME,
        content: "Use `pipeline` para propagar os erros.",
        status: "pending"
      }
    ])
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.reply.id, "r-1")
    assert.deepEqual(visibility.findPublishedPost.mock.calls[0].arguments, ["post-1"])
    assert.deepEqual(repository.hasAiReply.mock.calls[0].arguments, ["c-1"])
  })

  it("usa o agente com structuredOutput e abortSignal", async () => {
    await draftCommentReply("c-1")

    assert.deepEqual(getAgent.mock.calls[0].arguments, ["comment-replier"])
    const [, options] = generate.mock.calls[0].arguments
    assert.ok(options.structuredOutput.schema)
    assert.ok(options.abortSignal instanceof AbortSignal)
  })

  it("manda o post inteiro como contexto e o comentário delimitado", async () => {
    await draftCommentReply("c-1")

    const [prompt] = generate.mock.calls[0].arguments
    assert.match(prompt, /Título do post: Streams no Node\.js/)
    assert.match(prompt, /Conteúdo do post:\n## Introdução\n\nStreams são\.\.\./)
    assert.match(prompt, /Autor do comentário: Ana/)
    assert.match(prompt, /<comentario>\nComo trato erros em streams\?\n<\/comentario>/)
  })

  it("corta o conteúdo do post em 8000 caracteres", async () => {
    visibility.findPublishedPost.mock.mockImplementationOnce(async () => ({
      ...post,
      content: `${"a".repeat(8000)}FIM`
    }))

    await draftCommentReply("c-1")

    const [prompt] = generate.mock.calls[0].arguments
    assert.ok(prompt.includes("a".repeat(8000)))
    assert.ok(!prompt.includes("FIM"))
  })

  it("corta a resposta em 2000 caracteres", async () => {
    generate.mock.mockImplementationOnce(respond({ ...answer, reply: "a".repeat(2500) }))

    await draftCommentReply("c-1")

    const { content } = repository.insertComment.mock.calls[0].arguments[0]
    assert.equal(content.length, 2000)
    assert.ok(content.endsWith("…"))
  })

  it("retorna not_found quando o comentário não existe", async () => {
    repository.findCommentById.mock.mockImplementationOnce(async () => null)

    assert.deepEqual(await draftCommentReply("missing"), { ok: false, error: "not_found" })
    assert.equal(generate.mock.callCount(), 0)
  })

  for (const [name, overrides] of [
    ["pendente", { status: "pending" }],
    ["reprovado", { status: "rejected" }],
    ["que é uma resposta", { parent_id: "c-0" }],
    ["escrito pela IA", { author_type: "ai" }]
  ] as const) {
    it(`retorna not_eligible para comentário ${name}, sem chamar o agente`, async () => {
      repository.findCommentById.mock.mockImplementationOnce(async () => ({
        ...question,
        ...overrides
      }))

      assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "not_eligible" })
      assert.equal(generate.mock.callCount(), 0)
    })
  }

  it("retorna not_eligible quando o post não está publicado", async () => {
    visibility.findPublishedPost.mock.mockImplementationOnce(async () => null)

    assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "not_eligible" })
    assert.equal(generate.mock.callCount(), 0)
  })

  it("retorna already_replied sem chamar o agente quando já há rascunho", async () => {
    repository.hasAiReply.mock.mockImplementationOnce(async () => true)

    assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "already_replied" })
    assert.equal(generate.mock.callCount(), 0)
  })

  it("retorna already_replied quando o insert esbarra na unique index", async () => {
    repository.insertComment.mock.mockImplementationOnce(async () => {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "comments_ai_reply_per_parent_idx"
      })
    })

    assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "already_replied" })
  })

  it("propaga outros erros do insert", async () => {
    repository.insertComment.mock.mockImplementationOnce(async () => {
      throw new Error("db down")
    })

    await assert.rejects(draftCommentReply("c-1"), /db down/)
  })

  it("retorna not_a_question com o motivo do agente", async () => {
    generate.mock.mockImplementationOnce(
      respond({ is_question: false, answerable: false, reply: "", reason: "É um elogio" })
    )

    assert.deepEqual(await draftCommentReply("c-1"), {
      ok: false,
      error: "not_a_question",
      reason: "É um elogio"
    })
    assert.equal(repository.insertComment.mock.callCount(), 0)
  })

  it("retorna not_answerable quando o post não cobre a pergunta", async () => {
    generate.mock.mockImplementationOnce(
      respond({ is_question: true, answerable: false, reply: "", reason: "O post não fala disso" })
    )

    assert.deepEqual(await draftCommentReply("c-1"), {
      ok: false,
      error: "not_answerable",
      reason: "O post não fala disso"
    })
    assert.equal(repository.insertComment.mock.callCount(), 0)
  })

  it("retorna not_answerable quando a resposta vem vazia", async () => {
    generate.mock.mockImplementationOnce(respond({ ...answer, reply: "   " }))

    const result = await draftCommentReply("c-1")

    assert.equal(!result.ok && result.error, "not_answerable")
    assert.equal(repository.insertComment.mock.callCount(), 0)
  })

  it("retorna generation_failed e loga quando o modelo falha", async () => {
    generate.mock.mockImplementationOnce(async () => {
      throw new Error("provider down")
    })

    assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "generation_failed" })
    assert.equal(consoleError.mock.callCount(), 1)
    assert.equal(repository.insertComment.mock.callCount(), 0)
  })

  it("retorna generation_failed quando a resposta vem fora do schema", async () => {
    generate.mock.mockImplementationOnce(async () => ({ object: undefined }))

    assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "generation_failed" })
  })

  it("retorna generation_failed quando estoura o timeout", async () => {
    process.env.COMMENT_REPLY_TIMEOUT_MS = "20"
    generate.mock.mockImplementationOnce(
      (_prompt, { abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener("abort", () => reject(abortSignal.reason))
        })
    )

    assert.deepEqual(await draftCommentReply("c-1"), { ok: false, error: "generation_failed" })
  })
})
