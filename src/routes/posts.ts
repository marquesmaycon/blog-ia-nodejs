import { z } from "zod"

import type { App } from "../http/app.ts"
import { requireApiKey } from "../http/auth.ts"
import { sendValidationError } from "../http/validation.ts"
import { approvePost, createPostDraft, getPost, listPosts, rejectPost } from "../services/posts.ts"

const createPostDraftBodySchema = z.object({
  idea: z.string().trim().min(1)
})

// O filtro usa o slug (ex.: "node-js"), o mesmo que aparece em post.tags[].slug
const listPostsQuerySchema = z.object({
  tag: z
    .string()
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be a tag slug (e.g. 'node-js')")
    .optional()
})

export function registerPostRoutes(app: App) {
  app.get("/posts", async (req, res) => {
    const include = req.query.get("include")

    if (include !== null && include !== "all") {
      return res.status(400).send({ message: "Invalid value for 'include'" })
    }

    const query = listPostsQuerySchema.safeParse({ tag: req.query.get("tag") ?? undefined })
    if (!query.success) return sendValidationError(res, query.error, "Invalid query parameters")

    const includeAll = include === "all"

    if (includeAll && !requireApiKey(req, res)) return

    try {
      const posts = await listPosts({ includeAll, tag: query.data.tag })
      return res.send({ data: posts })
    } catch (error) {
      console.error("Falha ao listar os posts:", error)
      return res.status(500).send({ message: "Failed to list posts" })
    }
  })

  app.get("/posts/:id", async (req, res) => {
    try {
      const post = await getPost(req.params.id)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ data: post })
    } catch (error) {
      console.error("Falha ao buscar o post:", error)
      return res.status(500).send({ message: "Failed to get post" })
    }
  })

  app.patch("/posts/:id/approve", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const post = await approvePost(req.params.id)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ message: "Post approved", data: post })
    } catch (error) {
      console.error("Falha ao aprovar o post:", error)
      return res.status(500).send({ message: "Failed to approve post" })
    }
  })

  app.delete("/posts/:id/reject", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const post = await rejectPost(req.params.id)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ message: "Post rejected", data: post })
    } catch (error) {
      console.error("Falha ao reprovar o post:", error)
      return res.status(500).send({ message: "Failed to reject post" })
    }
  })

  app.post("/posts/draft", async (req, res) => {
    // Auth antes da validação: anônimo recebe 403 e nunca chega ao LLM
    if (!requireApiKey(req, res)) return

    const parsed = createPostDraftBodySchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, "Invalid request body")

    try {
      const post = await createPostDraft(parsed.data.idea)
      return res.status(201).send({ message: "Post draft created", data: post })
    } catch (error) {
      console.error("Falha ao gerar o post:", error)
      return res.status(502).send({ message: "Failed to generate post" })
    }
  })
}
