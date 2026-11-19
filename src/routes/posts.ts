import { z } from "zod"

import type { App } from "../http/app.ts"
import { createPostDraft, getPost, listPosts } from "../services/posts.ts"

const createPostDraftBodySchema = z.object({
  idea: z.string().trim().min(1)
})

export function registerPostRoutes(app: App) {
  app.get("/posts", async (_req, res) => {
    try {
      const posts = await listPosts()
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

  app.post("/posts/draft", async (req, res) => {
    const parsed = createPostDraftBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).send({ message: "Field 'idea' is required" })
    }

    try {
      const post = await createPostDraft(parsed.data.idea)
      return res.status(201).send({ message: "Post draft created", data: post })
    } catch (error) {
      console.error("Falha ao gerar o post:", error)
      return res.status(502).send({ message: "Failed to generate post" })
    }
  })
}
