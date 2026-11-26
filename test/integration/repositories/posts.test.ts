// Testa o repositório contra um Postgres real (banco blog_test, ver .env.test).
import assert from "node:assert/strict"
import { after, beforeEach, describe, it } from "node:test"

import type { NewPost, Post, PostFilters } from "../../../src/domain/posts.ts"
import {
  approvePostById,
  findPopularPosts,
  findPostById,
  findPosts,
  findPublishedPostBySlug,
  findTakenSlugs,
  insertPost,
  rejectPostById,
  updateDraftById
} from "../../../src/repositories/posts.ts"
import {
  pool,
  seedComment,
  seedLike,
  seedPost,
  seedPostTag,
  seedTag,
  truncatePosts
} from "../../helpers/db.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const APPROVED = { approved_at: "2026-01-01T00:00:00.000Z" }

const pickCounters = (post: Post | null) => ({
  likes_count: post?.likes_count,
  comments_count: post?.comments_count
})

// Slug único por chamada, para os testes que não testam o slug em si
const newPost = (data: Pick<NewPost, "title" | "content">): NewPost => ({
  slug: `slug-${crypto.randomUUID()}`,
  reading_time_minutes: 1,
  summary: null,
  meta_description: null,
  ...data
})

const ids = (posts: Post[]) => posts.map((post) => post.id).toSorted()

const FIRST_PAGE = { limit: 50, offset: 0 }

// Atalhos para os cenários que não testam a paginação em si
const findAllPosts = async (filters: PostFilters = {}) =>
  (await findPosts({ ...filters, approvedOnly: false }, FIRST_PAGE)).posts
const findApprovedPosts = async (filters: PostFilters = {}) =>
  (await findPosts({ ...filters, approvedOnly: true }, FIRST_PAGE)).posts

const searchIds = async (q: string) =>
  (await findPosts({ approvedOnly: true, q }, FIRST_PAGE)).posts.map((post) => post.id)

// Posts aprovados com published_at crescente (dia 1, dia 2, ...)
const seedApprovedSeries = (count: number) =>
  Promise.all(
    Array.from({ length: count }, (_, i) =>
      seedPost({
        ...APPROVED,
        published_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`
      })
    )
  )

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

describe("repositories/posts", () => {
  beforeEach(truncatePosts)
  after(() => pool.end())

  describe("insertPost", () => {
    it("persiste o post como rascunho, com id gerado e datas em ISO", async () => {
      const post = await insertPost(newPost({ title: "Título", content: "Conteúdo" }))

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
      const a = await insertPost(newPost({ title: "A", content: "A" }))
      const b = await insertPost(newPost({ title: "B", content: "B" }))

      assert.notEqual(a.id, b.id)
    })
  })

  describe("slug e tempo de leitura", () => {
    it("insertPost grava slug, reading_time_minutes e os metadados de SEO", async () => {
      const post = await insertPost({
        title: "Título",
        content: "Conteúdo",
        slug: "titulo",
        reading_time_minutes: 3,
        summary: "Resumo do post.",
        meta_description: "Descrição para buscadores."
      })

      assert.equal(post.slug, "titulo")
      assert.equal(post.reading_time_minutes, 3)
      assert.equal(post.summary, "Resumo do post.")
      assert.equal(post.meta_description, "Descrição para buscadores.")
    })

    it("insertPost aceita os metadados de SEO nulos", async () => {
      const post = await insertPost(newPost({ title: "Sem SEO", content: "Conteúdo" }))

      assert.equal(post.summary, null)
      assert.equal(post.meta_description, null)
    })

    it("rejeita slug repetido pela constraint posts_slug_key", async () => {
      await seedPost({ slug: "repetido" })

      await assert.rejects(
        insertPost({ ...newPost({ title: "B", content: "B" }), slug: "repetido" }),
        { code: "23505", constraint: "posts_slug_key" }
      )
    })

    it("findTakenSlugs traz a base e as variações numéricas, só elas", async () => {
      for (const slug of ["node", "node-2", "node-10", "node-js", "nodes", "outro"]) {
        await seedPost({ slug })
      }

      assert.deepEqual((await findTakenSlugs("node")).toSorted(), ["node", "node-10", "node-2"])
      assert.deepEqual(await findTakenSlugs("livre"), [])
    })

    it("findTakenSlugs ignora o post de excludeId", async () => {
      const post = await seedPost({ slug: "meu-post" })
      await seedPost({ slug: "meu-post-2" })

      assert.deepEqual(await findTakenSlugs("meu-post", post.id), ["meu-post-2"])
    })

    it("findPublishedPostBySlug só encontra posts aprovados", async () => {
      const published = await seedPost({ ...APPROVED, slug: "publicado" })
      await seedPost({ slug: "rascunho" })
      await seedPost({ slug: "reprovado", rejected_at: "2026-01-01T00:00:00.000Z" })

      assert.equal((await findPublishedPostBySlug("publicado"))?.id, published.id)
      assert.equal(await findPublishedPostBySlug("rascunho"), null)
      assert.equal(await findPublishedPostBySlug("reprovado"), null)
      assert.equal(await findPublishedPostBySlug("missing"), null)
    })
  })

  describe("updateDraftById", () => {
    const changes = {
      title: "Novo título zebra",
      content: "Novo conteúdo",
      slug: "novo-titulo-zebra",
      reading_time_minutes: 2,
      summary: "Novo resumo",
      meta_description: null
    }

    it("atualiza o rascunho e a coluna de busca acompanha", async () => {
      const draft = await seedPost({ title: "Antigo" })

      const updated = await updateDraftById(draft.id, changes)

      assert.equal(updated?.title, changes.title)
      assert.equal(updated?.content, changes.content)
      assert.equal(updated?.slug, changes.slug)
      assert.equal(updated?.reading_time_minutes, 2)
      assert.equal(updated?.summary, "Novo resumo")
      assert.equal(updated?.meta_description, null)

      await approvePostById(draft.id)
      assert.deepEqual(await searchIds("zebra"), [draft.id])
    })

    it("também edita posts reprovados", async () => {
      const rejected = await seedPost({ rejected_at: "2026-01-01T00:00:00.000Z" })

      assert.equal((await updateDraftById(rejected.id, changes))?.title, changes.title)
    })

    it("não altera posts aprovados e retorna null", async () => {
      const approved = await seedPost({ ...APPROVED, title: "Original" })

      assert.equal(await updateDraftById(approved.id, changes), null)
      assert.equal((await findPostById(approved.id))?.title, "Original")
    })

    it("retorna null quando o post não existe", async () => {
      assert.equal(await updateDraftById("missing", changes), null)
    })
  })

  describe("findPostById", () => {
    it("retorna null quando o post não existe", async () => {
      assert.equal(await findPostById("missing"), null)
    })
  })

  describe("findPosts: status e ordenação", () => {
    it("sem approvedOnly retorna todos, do mais recente para o mais antigo", async () => {
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

    it("com approvedOnly retorna apenas aprovados, ordenados", async () => {
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

  describe("findPosts: paginação", () => {
    it("fatia por limit/offset sem sobreposição e traz o total dos filtros", async () => {
      const seeded = await seedApprovedSeries(5)
      await seedPost() // rascunho: fora do total com approvedOnly
      const newestFirst = seeded.map((post) => post.id).toReversed()

      const first = await findPosts({ approvedOnly: true }, { limit: 2, offset: 0 })
      const second = await findPosts({ approvedOnly: true }, { limit: 2, offset: 2 })
      const last = await findPosts({ approvedOnly: true }, { limit: 2, offset: 4 })

      assert.deepEqual(
        [first, second, last].map((page) => page.posts.map((post) => post.id)),
        [newestFirst.slice(0, 2), newestFirst.slice(2, 4), newestFirst.slice(4)]
      )
      for (const page of [first, second, last]) assert.equal(page.total, 5)
      assert.equal((await findPosts({ approvedOnly: false }, FIRST_PAGE)).total, 6)
    })

    it("página além do fim devolve lista vazia com o total real", async () => {
      await seedApprovedSeries(3)

      assert.deepEqual(await findPosts({ approvedOnly: true }, { limit: 10, offset: 10 }), {
        posts: [],
        total: 3
      })
    })

    it("desempata pelo id quando published_at é igual, mantendo a ordem estável", async () => {
      const sameDate = { ...APPROVED, published_at: "2026-01-01T00:00:00.000Z" }
      const seeded = await Promise.all([1, 2, 3].map(() => seedPost(sameDate)))
      const expected = seeded
        .map((post) => post.id)
        .toSorted()
        .toReversed()

      const pages = await Promise.all(
        [0, 1, 2].map((offset) => findPosts({ approvedOnly: true }, { limit: 1, offset }))
      )

      assert.deepEqual(
        pages.map((page) => page.posts[0].id),
        expected
      )
    })

    it("devolve total 0 sem posts", async () => {
      assert.deepEqual(await findPosts({ approvedOnly: false }, FIRST_PAGE), {
        posts: [],
        total: 0
      })
    })
  })

  describe("findPosts: busca full-text", () => {
    it("encontra pelo título e pelo conteúdo, com stemming em português", async () => {
      const inTitle = await seedPost({ ...APPROVED, title: "Testes em Node.js", content: "x" })
      const inContent = await seedPost({
        ...APPROVED,
        title: "Outro assunto",
        content: "Como escrever um teste de integração"
      })
      const cake = await seedPost({ ...APPROVED, title: "Receita de bolo", content: "Farinha" })

      assert.deepEqual((await searchIds("teste")).toSorted(), [inTitle.id, inContent.id].toSorted())
      assert.deepEqual(
        (await searchIds("testes")).toSorted(),
        [inTitle.id, inContent.id].toSorted()
      )
      assert.deepEqual(await searchIds("bolo"), [cake.id])
      assert.deepEqual(await searchIds("kubernetes"), [])
    })

    it("ordena por relevância: match no título vem antes do match no conteúdo", async () => {
      // O post só com match no conteúdo é mais recente, então sem ranking viria primeiro
      const inTitle = await seedPost({
        ...APPROVED,
        published_at: "2026-01-01T00:00:00.000Z",
        title: "Streams no Node",
        content: "Um texto qualquer"
      })
      const inContent = await seedPost({
        ...APPROVED,
        published_at: "2026-02-01T00:00:00.000Z",
        title: "Outro assunto",
        content: "Fala de streams de passagem"
      })

      assert.deepEqual(await searchIds("streams"), [inTitle.id, inContent.id])
    })

    it("aceita a sintaxe de buscador sem quebrar com entrada estranha", async () => {
      const both = await seedPost({ ...APPROVED, title: "Node e Deno", content: "runtimes" })
      const onlyNode = await seedPost({ ...APPROVED, title: "Só Node", content: "runtime" })

      assert.deepEqual(await searchIds("node -deno"), [onlyNode.id])
      assert.deepEqual(await searchIds('"node e deno"'), [both.id])
      for (const q of ["node -js or", "&&| !(:*", "'; DROP TABLE posts; --", "-"]) {
        await assert.doesNotReject(searchIds(q), `q=${q}`)
      }
      assert.equal((await findAllPosts()).length, 2)
    })

    it("combina q com tag e approvedOnly, e o total respeita a busca", async () => {
      const node = await seedTag({ name: "Node.js" })
      const approvedTagged = await seedPost({ ...APPROVED, title: "Streams" })
      const draftTagged = await seedPost({ title: "Streams" })
      await seedPost({ ...APPROVED, title: "Streams" }) // sem a tag
      await seedPost({ ...APPROVED, title: "Outra coisa" })
      await seedPostTag({ post_id: approvedTagged.id, tag_id: node.id })
      await seedPostTag({ post_id: draftTagged.id, tag_id: node.id })

      const approved = await findPosts(
        { approvedOnly: true, tag: "node-js", q: "streams" },
        FIRST_PAGE
      )
      const all = await findPosts({ approvedOnly: false, tag: "node-js", q: "streams" }, FIRST_PAGE)

      assert.deepEqual(ids(approved.posts), [approvedTagged.id])
      assert.equal(approved.total, 1)
      assert.deepEqual(ids(all.posts), [approvedTagged.id, draftTagged.id].toSorted())
      assert.equal(all.total, 2)
      assert.equal((await findPosts({ approvedOnly: true, q: "streams" }, FIRST_PAGE)).total, 2)
    })

    it("não expõe a coluna search no post", async () => {
      await seedPost(APPROVED)

      const [post] = await findApprovedPosts()

      assert.equal("search" in post, false)
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
      const post = await insertPost(newPost({ title: "Título", content: "Conteúdo" }))

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

  describe("tags", () => {
    it("começam vazias num post novo", async () => {
      const post = await insertPost(newPost({ title: "Título", content: "Conteúdo" }))

      assert.deepEqual(post.tags, [])
    })

    it("vêm ordenadas pelo nome em todas as consultas", async () => {
      const post = await seedPost(APPROVED)
      for (const name of ["TypeScript", "IA"]) {
        const tag = await seedTag({ name })
        await seedPostTag({ post_id: post.id, tag_id: tag.id })
      }
      await seedLike({ post_id: post.id })

      const expected = [
        { name: "IA", slug: "ia" },
        { name: "TypeScript", slug: "typescript" }
      ]
      assert.deepEqual((await findPostById(post.id))?.tags, expected)
      assert.deepEqual((await findAllPosts())[0].tags, expected)
      assert.deepEqual((await findApprovedPosts())[0].tags, expected)
      assert.deepEqual((await findPopularPosts({ days: 7, limit: 10 }))[0].tags, expected)
      assert.deepEqual((await rejectPostById(post.id))?.tags, expected)
    })

    it("filtram a listagem pelo slug, em aprovados e em todos", async () => {
      const node = await seedTag({ name: "Node.js" })
      const ia = await seedTag({ name: "IA" })
      const approvedNode = await seedPost(APPROVED)
      const draftNode = await seedPost()
      const approvedIa = await seedPost(APPROVED)
      await seedPost(APPROVED)
      await seedPostTag({ post_id: approvedNode.id, tag_id: node.id })
      await seedPostTag({ post_id: draftNode.id, tag_id: node.id })
      await seedPostTag({ post_id: approvedIa.id, tag_id: ia.id })

      assert.deepEqual(ids(await findApprovedPosts({ tag: "node-js" })), [approvedNode.id])
      assert.deepEqual(
        ids(await findAllPosts({ tag: "node-js" })),
        [approvedNode.id, draftNode.id].toSorted()
      )
      assert.deepEqual(await findApprovedPosts({ tag: "missing" }), [])
      assert.equal((await findApprovedPosts({})).length, 3)
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
