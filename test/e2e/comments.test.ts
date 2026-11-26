// Fluxo completo de comentários pela API HTTP (supertest), com Postgres real (banco blog_test).
// O moderador IA é mockado em mastra.getAgent; por padrão manda tudo para revisão humana.
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it, mock } from "node:test"

import request from "supertest"

import { createApp } from "../../src/http/app.ts"
import { mastra } from "../../src/mastra/index.ts"
import type { Comment } from "../../src/repositories/comments.ts"
import { registerCommentRoutes } from "../../src/routes/comments.ts"
import { registerPostRoutes } from "../../src/routes/posts.ts"
import { pool, seedComment, seedPost, truncatePosts } from "../helpers/db.ts"

const API_KEY = process.env.API_KEY ?? ""
const auth = { Authorization: `Bearer ${API_KEY}` }

const app = createApp()
registerPostRoutes(app)
// Cota folgada: o app é compartilhado entre os testes, e o limite tem e2e próprio (rate-limit.test.ts)
registerCommentRoutes(app, { rateLimit: { max: 1000, windowMs: 60_000 } })
const api = () => request(app.server)

const ids = (comments: Comment[]) => comments.map((comment) => comment.id)

// Só o LLM é substituído (ver test/e2e/posts.test.ts): o moderador responde o veredito dado
function mockModerator(generate: () => Promise<unknown>) {
  return mock.method(mastra, "getAgent", (() => ({ generate })) as never)
}

// Para as respostas: o agente comment-replier devolve `reply`; os demais agentes, o moderador
function mockReplier(reply: () => Promise<unknown>) {
  mock.restoreAll()
  return mock.method(mastra, "getAgent", ((id: string) => ({
    generate:
      id === "comment-replier"
        ? reply
        : async () => ({ object: { verdict: "approve", reason: "Ok", categories: [] } })
  })) as never)
}

const approvedPost = () => seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

const replierAnswer = (object: Record<string, unknown>) =>
  mockReplier(async () => ({
    object: { is_question: true, answerable: true, reply: "", reason: "Motivo", ...object }
  }))

const moderatorVerdict = (verdict: string, reason = "Motivo", categories: string[] = []) =>
  mockModerator(async () => ({ object: { verdict, reason, categories } }))

describe("E2E comentários", () => {
  beforeEach(async () => {
    await truncatePosts()
    moderatorVerdict("review", "Precisa de revisão humana")
  })
  afterEach(() => mock.restoreAll())
  after(() => pool.end())

  it("ciclo de vida: comentário em revisão → aprovado → apagado", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

    // 1. Leitor comenta e o moderador pede revisão: fica pendente e não aparece publicamente
    const created = await api()
      .post(`/posts/${post.id}/comments`)
      .send({ author_name: "Ana", content: "Muito bom!" })
      .expect(201)

    const comment: Comment = created.body.data
    assert.equal(created.body.message, "Comment awaiting moderation")
    assert.equal(comment.status, "pending")
    assert.equal(comment.post_id, post.id)
    assert.equal(comment.moderation_reason, "Precisa de revisão humana")

    assert.deepEqual((await api().get(`/posts/${post.id}/comments`).expect(200)).body, {
      data: []
    })

    // 2. Aparece na fila de moderação
    const queue = await api().get("/comments").set(auth).expect(200)
    assert.deepEqual(ids(queue.body.data), [comment.id])

    // 3. Admin aprova: sai da fila e passa a ser público
    const approved = await api().patch(`/comments/${comment.id}/approve`).set(auth).expect(200)
    assert.equal(approved.body.data.status, "approved")

    assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    const publicList = await api().get(`/posts/${post.id}/comments`).expect(200)
    assert.deepEqual(ids(publicList.body.data), [comment.id])

    // 4. Admin apaga: some de vez
    await api().delete(`/comments/${comment.id}`).set(auth).expect(200, {
      message: "Comment deleted"
    })
    assert.deepEqual((await api().get(`/posts/${post.id}/comments`).expect(200)).body, {
      data: []
    })
    await api().delete(`/comments/${comment.id}`).set(auth).expect(404)
  })

  describe("moderador IA", () => {
    const body = { author_name: "Ana", content: "Muito bom!" }

    it("approve publica o comentário na hora", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      mock.restoreAll()
      moderatorVerdict("approve", "Comentário legítimo")

      const res = await api().post(`/posts/${post.id}/comments`).send(body).expect(201)

      assert.equal(res.body.message, "Comment published")
      assert.equal(res.body.data.status, "approved")
      assert.equal(res.body.data.moderation_reason, null)

      const publicList = await api().get(`/posts/${post.id}/comments`).expect(200)
      assert.deepEqual(ids(publicList.body.data), [res.body.data.id])
      assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    })

    it("reject reprova com motivo e categorias, fora da listagem pública", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      mock.restoreAll()
      moderatorVerdict("reject", "Propaganda de produto", ["spam", "self-promotion"])

      const res = await api().post(`/posts/${post.id}/comments`).send(body).expect(201)

      assert.equal(res.body.message, "Comment rejected")

      const rejected = await api().get("/comments?status=rejected").set(auth).expect(200)
      assert.deepEqual(ids(rejected.body.data), [res.body.data.id])
      assert.equal(rejected.body.data[0].moderation_reason, "Propaganda de produto")
      assert.deepEqual(rejected.body.data[0].moderation_categories, ["spam", "self-promotion"])
      assert.deepEqual((await api().get(`/posts/${post.id}/comments`).expect(200)).body, {
        data: []
      })
    })

    it("falha do LLM deixa o comentário pendente, sem motivo", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      mock.restoreAll()
      mock.method(console, "error", () => {})
      mockModerator(async () => {
        throw new Error("provider down")
      })

      const res = await api().post(`/posts/${post.id}/comments`).send(body).expect(201)

      assert.equal(res.body.message, "Comment awaiting moderation")
      assert.equal(res.body.data.status, "pending")
      assert.equal(res.body.data.moderation_reason, null)
      assert.deepEqual(res.body.data.moderation_categories, [])

      const queue = await api().get("/comments").set(auth).expect(200)
      assert.deepEqual(ids(queue.body.data), [res.body.data.id])
    })
  })

  it("filtra a listagem administrativa por status", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
    const rejected = await seedComment({
      post_id: post.id,
      status: "rejected",
      moderation_reason: "spam"
    })
    await seedComment({ post_id: post.id })

    const res = await api().get("/comments?status=rejected").set(auth).expect(200)

    assert.deepEqual(ids(res.body.data), [rejected.id])
    assert.equal(res.body.data[0].moderation_reason, "spam")
  })

  describe("respostas da IA (POST /comments/:id/reply)", () => {
    it("ciclo de vida: pergunta aprovada → rascunho da IA → aprovado → público", async () => {
      const post = await approvedPost()
      replierAnswer({ reply: "Use `pipeline`, como mostra a seção 2." })

      // 1. Leitor pergunta e o moderador aprova
      const created = await api()
        .post(`/posts/${post.id}/comments`)
        .send({ author_name: "Ana", content: "Como trato erros em streams?" })
        .expect(201)
      const question: Comment = created.body.data
      assert.equal(question.status, "approved")
      assert.equal(question.author_type, "reader")

      // 2. Admin pede o rascunho: fica pendente, filho da pergunta
      const res = await api().post(`/comments/${question.id}/reply`).set(auth).expect(201)
      const reply: Comment = res.body.data
      assert.equal(res.body.message, "Reply draft created")
      assert.equal(reply.parent_id, question.id)
      assert.equal(reply.post_id, post.id)
      assert.equal(reply.author_type, "ai")
      assert.equal(reply.status, "pending")
      assert.equal(reply.content, "Use `pipeline`, como mostra a seção 2.")

      // 3. Fica fora da listagem pública e entra na fila de moderação
      const unpublished = await api().get(`/posts/${post.id}/comments`).expect(200)
      assert.deepEqual(ids(unpublished.body.data), [question.id])
      const queue = await api().get("/comments").set(auth).expect(200)
      assert.deepEqual(ids(queue.body.data), [reply.id])

      // 4. Pedir de novo não gera outro rascunho
      await api()
        .post(`/comments/${question.id}/reply`)
        .set(auth)
        .expect(409, { message: "Reply already exists" })

      // 5. Admin aprova: aparece depois da pergunta e conta no post
      await api().patch(`/comments/${reply.id}/approve`).set(auth).expect(200)
      const published = await api().get(`/posts/${post.id}/comments`).expect(200)
      assert.deepEqual(ids(published.body.data), [question.id, reply.id])
      assert.equal(published.body.data[1].parent_id, question.id)
      const postRes = await api().get(`/posts/${post.id}`).expect(200)
      assert.equal(postRes.body.data.comments_count, 2)

      // 6. Apagar a pergunta apaga a resposta
      await api().delete(`/comments/${question.id}`).set(auth).expect(200)
      await api().delete(`/comments/${reply.id}`).set(auth).expect(404)
    })

    it("apagar o rascunho permite gerar outro", async () => {
      const post = await approvedPost()
      const question = await seedComment({ post_id: post.id, status: "approved" })
      replierAnswer({ reply: "Primeira" })

      const first = await api().post(`/comments/${question.id}/reply`).set(auth).expect(201)
      await api().delete(`/comments/${first.body.data.id}`).set(auth).expect(200)

      replierAnswer({ reply: "Segunda" })
      const second = await api().post(`/comments/${question.id}/reply`).set(auth).expect(201)
      assert.equal(second.body.data.content, "Segunda")
    })

    it("responde 422 quando não é pergunta, sem gravar nada", async () => {
      const post = await approvedPost()
      const comment = await seedComment({ post_id: post.id, status: "approved" })
      replierAnswer({ is_question: false, answerable: false, reason: "É um elogio" })

      await api().post(`/comments/${comment.id}/reply`).set(auth).expect(422, {
        message: "Comment is not an answerable question",
        reason: "É um elogio"
      })
      assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    })

    it("responde 502 quando o agente falha, sem gravar nada", async () => {
      const post = await approvedPost()
      const comment = await seedComment({ post_id: post.id, status: "approved" })
      mockReplier(async () => {
        throw new Error("provider down")
      })
      mock.method(console, "error", () => {})

      await api()
        .post(`/comments/${comment.id}/reply`)
        .set(auth)
        .expect(502, { message: "Failed to generate reply" })
      assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    })

    it("responde 409 para comentário pendente e para uma resposta", async () => {
      const post = await approvedPost()
      const pending = await seedComment({ post_id: post.id })
      const parent = await seedComment({ post_id: post.id, status: "approved" })
      const reply = await seedComment({
        post_id: post.id,
        status: "approved",
        parent_id: parent.id,
        author_type: "ai"
      })
      const getAgent = replierAnswer({ reply: "Oi" })

      for (const comment of [pending, reply]) {
        await api()
          .post(`/comments/${comment.id}/reply`)
          .set(auth)
          .expect(409, { message: "Comment cannot be replied" })
      }
      assert.equal(getAgent.mock.callCount(), 0)
    })

    it("responde 404 para comentário inexistente e 403 sem API key", async () => {
      await api()
        .post("/comments/inexistente/reply")
        .set(auth)
        .expect(404, { message: "Comment not found" })
      await api().post("/comments/inexistente/reply").expect(403, { message: "Forbidden" })
    })
  })

  describe("só posts aprovados aceitam e exibem comentários", () => {
    const body = { author_name: "Ana", content: "Oi" }
    const notFound = { message: "Post not found" }

    it("responde 404 para post inexistente", async () => {
      await api().get("/posts/inexistente/comments").expect(404, notFound)
      await api().post("/posts/inexistente/comments").send(body).expect(404, notFound)
    })

    it("responde 404 para rascunho e reprovado, sem persistir nada", async () => {
      const draft = await seedPost()
      const rejected = await seedPost({ rejected_at: "2026-01-01T00:00:00.000Z" })

      for (const post of [draft, rejected]) {
        await api().get(`/posts/${post.id}/comments`).expect(404, notFound)
        await api().post(`/posts/${post.id}/comments`).send(body).expect(404, notFound)
      }

      assert.deepEqual((await api().get("/comments").set(auth).expect(200)).body, { data: [] })
    })
  })

  describe("autorização das rotas administrativas", () => {
    it("responde 403 sem API key e não altera o comentário", async () => {
      const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })
      const comment = await seedComment({ post_id: post.id })
      const forbidden = { message: "Forbidden" }

      await api().get("/comments").expect(403, forbidden)
      await api().patch(`/comments/${comment.id}/approve`).expect(403, forbidden)
      await api().delete(`/comments/${comment.id}`).expect(403, forbidden)

      const queue = await api().get("/comments").set(auth).expect(200)
      assert.deepEqual(queue.body.data, [comment])
    })
  })

  it("responde 400 para comentário inválido", async () => {
    const post = await seedPost({ approved_at: "2026-01-01T00:00:00.000Z" })

    await api()
      .post(`/posts/${post.id}/comments`)
      .send({ author_name: "Ana", content: "" })
      .expect(400)
  })
})
