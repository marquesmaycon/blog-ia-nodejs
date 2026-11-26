// Testa as regras do service isoladamente: repositório e Mastra são substituídos por mocks.
// Requer --experimental-test-module-mocks.
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

import type { NewPostReview, PostReview } from "../../../src/domain/post-reviews.ts"
import type {
  DraftChanges,
  NewPost,
  Pagination,
  Post,
  PostTag,
  PostsPage
} from "../../../src/domain/posts.ts"
import type { DraftReview, PostSeo } from "../../../src/mastra/workflows/post-drafting.ts"
import type { FindPostsFilters } from "../../../src/repositories/posts.ts"

const post: Post = {
  id: "abc",
  slug: "titulo",
  title: "Título",
  reading_time_minutes: 1,
  content: "Conteúdo",
  summary: null,
  meta_description: null,
  published_at: "2026-01-01T00:00:00.000Z",
  approved_at: null,
  rejected_at: null,
  likes_count: 0,
  comments_count: 0,
  tags: []
}

const repository = {
  findPosts: mock.fn(
    async (_filters: FindPostsFilters, _pagination: Pagination): Promise<PostsPage> => ({
      posts: [post],
      total: 23
    })
  ),
  findPostById: mock.fn(async (_id: string): Promise<Post | null> => post),
  findPublishedPostBySlug: mock.fn(async (_slug: string): Promise<Post | null> => post),
  findTakenSlugs: mock.fn(async (_base: string, _excludeId?: string): Promise<string[]> => []),
  updateDraftById: mock.fn(async (_id: string, data: DraftChanges): Promise<Post | null> => ({
    ...post,
    ...data
  })),
  approvePostById: mock.fn(async (_id: string): Promise<Post | null> => post),
  rejectPostById: mock.fn(async (_id: string): Promise<Post | null> => post)
}

const toSavedReview = (review: NewPostReview, postId: string): PostReview => ({
  id: `review-${review.attempt}`,
  post_id: postId,
  created_at: "2026-01-01T00:00:00.000Z",
  ...review
})

const reviewsRepository = {
  insertPostWithReviews: mock.fn(
    async (data: NewPost, reviews: NewPostReview[], _tags?: PostTag[]) => ({
      post: { ...post, ...data },
      reviews: reviews.map((review) => toSavedReview(review, post.id))
    })
  )
}

// services/tags (real) também importa deste módulo, por isso todas as funções aparecem aqui
const tagsRepository = {
  findAllTagNames: mock.fn(async (): Promise<string[]> => ["Node.js", "Testes"]),
  replacePostTags: mock.fn(async () => {}),
  findTagsWithApprovedPosts: mock.fn(async () => []),
  deleteTagBySlug: mock.fn(async () => true)
}

const generatedReviews: DraftReview[] = [
  { attempt: 1, score: 5, issues: ["raso"], suggestions: ["aprofunde"] },
  { attempt: 2, score: 8, issues: [], suggestions: [] }
]

type WorkflowResult =
  | {
      status: "success"
      result: { title: string; content: string; reviews: DraftReview[]; seo: PostSeo | null }
    }
  | { status: "failed"; error: Error }

const start = mock.fn(
  async (_options: { inputData: { idea: string } }): Promise<WorkflowResult> => ({
    status: "success",
    result: { title: "Gerado", content: "## Corpo", reviews: generatedReviews, seo: null }
  })
)
const createRun = mock.fn(async () => ({ start }))
const getWorkflow = mock.fn((_id: string) => ({ createRun }))

mock.module(import.meta.resolve("../../../src/repositories/posts.ts"), { exports: repository })
mock.module(import.meta.resolve("../../../src/repositories/post-reviews.ts"), {
  exports: reviewsRepository
})
mock.module(import.meta.resolve("../../../src/repositories/tags.ts"), { exports: tagsRepository })
mock.module(import.meta.resolve("../../../src/mastra/index.ts"), {
  exports: { mastra: { getWorkflow } }
})
mock.module(import.meta.resolve("../../../src/mastra/workflows/post-drafting.ts"), {
  exports: { POST_DRAFTING_WORKFLOW_ID: "post-drafting" }
})

const {
  approvePost,
  createPostDraft,
  generateUniqueSlug,
  getPost,
  getPublishedPostBySlug,
  listPosts,
  rejectPost,
  updatePostDraft
} = await import("../../../src/services/posts.ts")

// Próxima execução do workflow devolve este texto, estas revisões e este SEO
const generated = (
  title: string,
  content: string,
  reviews: DraftReview[] = [],
  seo: PostSeo | null = null
) =>
  start.mock.mockImplementationOnce(async () => ({
    status: "success",
    result: { title, content, reviews, seo }
  }))

const seo: PostSeo = {
  summary: "Resumo do post.",
  meta_description: "Descrição para buscadores.",
  slug: "Slug da IA",
  tags: ["Node.js", "node js", "Testes"]
}

const slugConflict = () =>
  Object.assign(new Error("duplicate key"), { code: "23505", constraint: "posts_slug_key" })

const APPROVED_AT = "2026-01-02T00:00:00.000Z"

describe("services/posts", () => {
  beforeEach(() => {
    for (const fn of [
      ...Object.values(repository),
      ...Object.values(reviewsRepository),
      ...Object.values(tagsRepository),
      start,
      createRun,
      getWorkflow
    ])
      fn.mock.resetCalls()
  })

  describe("listPosts", () => {
    it("busca apenas aprovados, na primeira página com o limite padrão", async () => {
      const result = await listPosts()

      assert.deepEqual(result, { data: [post], meta: { page: 1, limit: 10, total: 23 } })
      assert.deepEqual(repository.findPosts.mock.calls[0].arguments, [
        { approvedOnly: true, tag: undefined, q: undefined },
        { limit: 10, offset: 0 }
      ])
    })

    it("busca todos com includeAll", async () => {
      await listPosts({ includeAll: true })

      assert.equal(repository.findPosts.mock.calls[0].arguments[0].approvedOnly, false)
    })

    it("repassa tag e q ao repositório", async () => {
      await listPosts({ tag: "node-js", q: "streams" })

      assert.deepEqual(repository.findPosts.mock.calls[0].arguments[0], {
        approvedOnly: true,
        tag: "node-js",
        q: "streams"
      })
    })

    it("converte page e limit em offset e devolve no meta", async () => {
      const result = await listPosts({ page: 3, limit: 5 })

      assert.deepEqual(repository.findPosts.mock.calls[0].arguments[1], { limit: 5, offset: 10 })
      assert.deepEqual(result.meta, { page: 3, limit: 5, total: 23 })
    })
  })

  describe("getPost / approvePost / rejectPost", () => {
    it("delegam ao repositório com o id", async () => {
      await getPost("1")
      await approvePost("2")
      await rejectPost("3")

      assert.deepEqual(repository.findPostById.mock.calls[0].arguments, ["1"])
      assert.deepEqual(repository.approvePostById.mock.calls[0].arguments, ["2"])
      assert.deepEqual(repository.rejectPostById.mock.calls[0].arguments, ["3"])
    })

    it("propagam null quando o post não existe", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => null)

      assert.equal(await getPost("missing"), null)
    })
  })

  describe("createPostDraft", () => {
    const insert = reviewsRepository.insertPostWithReviews

    it("roda o workflow com a ideia e as tags existentes e grava o post com as revisões", async () => {
      const result = await createPostDraft("testes com node")

      assert.deepEqual(getWorkflow.mock.calls[0].arguments, ["post-drafting"])
      assert.deepEqual(start.mock.calls[0].arguments, [
        { inputData: { idea: "testes com node", existingTags: ["Node.js", "Testes"] } }
      ])

      assert.deepEqual(insert.mock.calls[0].arguments, [
        {
          title: "Gerado",
          content: "## Corpo",
          slug: "gerado",
          reading_time_minutes: 1,
          summary: null,
          meta_description: null
        },
        generatedReviews,
        []
      ])
      assert.equal(result.title, "Gerado")
    })

    it("grava o SEO gerado: slug da IA, metadados e tags sem repetição", async () => {
      generated("Gerado", "## Corpo", generatedReviews, seo)

      await createPostDraft("ideia")

      const [data, , tags] = insert.mock.calls[0].arguments
      assert.equal(data.slug, "slug-da-ia")
      assert.equal(data.summary, "Resumo do post.")
      assert.equal(data.meta_description, "Descrição para buscadores.")
      assert.deepEqual(tags, [
        { name: "Node.js", slug: "node-js" },
        { name: "Testes", slug: "testes" }
      ])
    })

    it("usa o título quando o slug da IA vem vazio", async () => {
      generated("Título Gerado", "## Corpo", [], { ...seo, slug: "" })

      await createPostDraft("ideia")

      assert.equal(insert.mock.calls[0].arguments[0].slug, "titulo-gerado")
    })

    it("trata colisão no slug da IA como no slug do título", async () => {
      generated("Gerado", "## Corpo", [], seo)
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["slug-da-ia"])

      await createPostDraft("ideia")

      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, ["slug-da-ia", undefined])
      assert.equal(insert.mock.calls[0].arguments[0].slug, "slug-da-ia-2")
    })

    it("devolve a última revisão junto com o post", async () => {
      const result = await createPostDraft("ideia")

      assert.equal(result.review?.attempt, 2)
      assert.equal(result.review?.score, 8)
    })

    it("devolve review null quando o revisor não respondeu", async () => {
      generated("Gerado", "## Corpo", [])

      const result = await createPostDraft("ideia")

      assert.equal(result.review, null)
      assert.deepEqual(insert.mock.calls[0].arguments[1], [])
    })

    it("calcula o tempo de leitura a partir do conteúdo gerado", async () => {
      generated("Longo", "palavra ".repeat(401))

      await createPostDraft("ideia")

      assert.equal(insert.mock.calls[0].arguments[0].reading_time_minutes, 3)
    })

    it("lança erro e não persiste nada quando o workflow falha", async () => {
      const cause = new Error("LLM indisponível")
      start.mock.mockImplementationOnce(async () => ({ status: "failed", error: cause }))

      await assert.rejects(createPostDraft("ideia"), (error: Error) => {
        assert.match(error.message, /post-drafting terminou com status failed/)
        assert.equal(error.cause, cause)
        return true
      })
      assert.equal(insert.mock.callCount(), 0)
    })

    it("gera outro slug e tenta de novo quando o insert colide no UNIQUE", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => [], 0)
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["gerado"], 1)
      insert.mock.mockImplementationOnce(async () => {
        throw slugConflict()
      })

      const result = await createPostDraft("ideia")

      assert.equal(insert.mock.callCount(), 2)
      assert.equal(result.slug, "gerado-2")
      // O workflow roda uma vez só: a nova tentativa reaproveita o texto gerado
      assert.equal(start.mock.callCount(), 1)
    })

    it("desiste depois de 3 colisões seguidas", async () => {
      for (const call of [0, 1, 2]) {
        insert.mock.mockImplementationOnce(async () => {
          throw slugConflict()
        }, call)
      }

      await assert.rejects(createPostDraft("ideia"), { code: "23505" })
      assert.equal(insert.mock.callCount(), 3)
    })

    it("não tenta de novo em outros erros do banco", async () => {
      insert.mock.mockImplementationOnce(async () => {
        throw Object.assign(new Error("fk"), { code: "23503" })
      })

      await assert.rejects(createPostDraft("ideia"), /fk/)
      assert.equal(insert.mock.callCount(), 1)
    })
  })

  describe("generateUniqueSlug", () => {
    it("usa o slug do título quando está livre", async () => {
      assert.equal(await generateUniqueSlug("Programação Funcional"), "programacao-funcional")
      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, [
        "programacao-funcional",
        undefined
      ])
    })

    it("soma 1 ao maior sufixo em uso", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => [
        "node",
        "node-2",
        "node-10"
      ])

      assert.equal(await generateUniqueSlug("Node"), "node-11")
    })

    it("usa -2 quando só a base está em uso", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["node"])

      assert.equal(await generateUniqueSlug("Node"), "node-2")
    })

    it("mantém a base quando só variações numéricas estão em uso", async () => {
      repository.findTakenSlugs.mock.mockImplementationOnce(async () => ["node-2"])

      assert.equal(await generateUniqueSlug("Node"), "node")
    })

    it('cai em "post" quando o título não gera slug', async () => {
      assert.equal(await generateUniqueSlug("!!!"), "post")
    })

    it("limita a 80 caracteres sem deixar hífen no fim", async () => {
      assert.equal(await generateUniqueSlug(`${"a".repeat(79)} bcd`), "a".repeat(79))
    })

    it("repassa o excludeId", async () => {
      await generateUniqueSlug("Node", "abc")

      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, ["node", "abc"])
    })
  })

  describe("getPublishedPostBySlug", () => {
    it("delega ao repositório", async () => {
      assert.equal(await getPublishedPostBySlug("titulo"), post)
      assert.deepEqual(repository.findPublishedPostBySlug.mock.calls[0].arguments, ["titulo"])
    })
  })

  describe("updatePostDraft", () => {
    it("responde not_found quando o post não existe", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => null)

      assert.deepEqual(await updatePostDraft("missing", { title: "T", content: "C" }), {
        status: "not_found"
      })
      assert.equal(repository.updateDraftById.mock.callCount(), 0)
    })

    it("responde approved quando o post já foi aprovado", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => ({
        ...post,
        approved_at: APPROVED_AT
      }))

      assert.deepEqual(await updatePostDraft("abc", { title: "T", content: "C" }), {
        status: "approved"
      })
      assert.equal(repository.updateDraftById.mock.callCount(), 0)
    })

    it("regera o slug (ignorando o próprio post) quando o título muda", async () => {
      const result = await updatePostDraft("abc", { title: "Novo Título", content: "Texto" })

      assert.deepEqual(repository.findTakenSlugs.mock.calls[0].arguments, ["novo-titulo", "abc"])
      assert.deepEqual(repository.updateDraftById.mock.calls[0].arguments, [
        "abc",
        {
          title: "Novo Título",
          content: "Texto",
          slug: "novo-titulo",
          reading_time_minutes: 1,
          summary: null,
          meta_description: null
        }
      ])
      assert.equal(result.status, "updated")
    })

    it("mantém o slug quando o título não muda e recalcula o tempo de leitura", async () => {
      const content = "palavra ".repeat(250)

      await updatePostDraft("abc", { title: post.title, content })

      assert.equal(repository.findTakenSlugs.mock.callCount(), 0)
      assert.deepEqual(repository.updateDraftById.mock.calls[0].arguments, [
        "abc",
        {
          title: post.title,
          content,
          slug: "titulo",
          reading_time_minutes: 2,
          summary: null,
          meta_description: null
        }
      ])
    })

    it("mantém summary e meta_description atuais quando não vêm na edição", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => ({
        ...post,
        summary: "Resumo atual",
        meta_description: "Meta atual"
      }))

      await updatePostDraft("abc", { title: post.title, content: "C" })

      const [, changes] = repository.updateDraftById.mock.calls[0].arguments
      assert.equal(changes.summary, "Resumo atual")
      assert.equal(changes.meta_description, "Meta atual")
    })

    it("substitui ou limpa (null) summary e meta_description quando vêm na edição", async () => {
      repository.findPostById.mock.mockImplementationOnce(async () => ({
        ...post,
        summary: "Resumo atual",
        meta_description: "Meta atual"
      }))

      await updatePostDraft("abc", {
        title: post.title,
        content: "C",
        summary: "Resumo novo",
        meta_description: null
      })

      const [, changes] = repository.updateDraftById.mock.calls[0].arguments
      assert.equal(changes.summary, "Resumo novo")
      assert.equal(changes.meta_description, null)
    })

    it("responde approved quando o post foi aprovado entre a leitura e o update", async () => {
      repository.updateDraftById.mock.mockImplementationOnce(async () => null)
      repository.findPostById.mock.mockImplementationOnce(async () => post, 0)
      repository.findPostById.mock.mockImplementationOnce(
        async () => ({ ...post, approved_at: APPROVED_AT }),
        1
      )

      assert.deepEqual(await updatePostDraft("abc", { title: post.title, content: "C" }), {
        status: "approved"
      })
    })

    it("responde not_found quando o post sumiu entre a leitura e o update", async () => {
      repository.updateDraftById.mock.mockImplementationOnce(async () => null)
      repository.findPostById.mock.mockImplementationOnce(async () => post, 0)
      repository.findPostById.mock.mockImplementationOnce(async () => null, 1)

      assert.deepEqual(await updatePostDraft("abc", { title: post.title, content: "C" }), {
        status: "not_found"
      })
    })
  })
})
