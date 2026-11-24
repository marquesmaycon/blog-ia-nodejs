import { z } from "zod"

import type { App } from "../http/app.ts"
import { requireApiKey } from "../http/auth.ts"
import { sendValidationError } from "../http/validation.ts"
import { deleteTag, listTags, setPostTags } from "../services/tags.ts"
import { slugify } from "../utils/slugify.ts"

const setPostTagsBodySchema = z.object({
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(40)
        .refine((name) => slugify(name) !== "", "Must contain letters or digits")
    )
    .max(10)
})

export function registerTagRoutes(app: App) {
  app.get("/tags", async (_req, res) => {
    try {
      const tags = await listTags()
      return res.send({ data: tags })
    } catch (error) {
      console.error("Falha ao listar as tags:", error)
      return res.status(500).send({ message: "Failed to list tags" })
    }
  })

  app.put("/posts/:id/tags", async (req, res) => {
    if (!requireApiKey(req, res)) return

    const parsed = setPostTagsBodySchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, "Invalid request body")

    try {
      const post = await setPostTags(req.params.id, parsed.data.tags)

      if (!post) {
        return res.status(404).send({ message: "Post not found" })
      }

      return res.send({ message: "Post tags updated", data: post })
    } catch (error) {
      console.error("Falha ao atualizar as tags do post:", error)
      return res.status(500).send({ message: "Failed to update post tags" })
    }
  })

  app.delete("/tags/:slug", async (req, res) => {
    if (!requireApiKey(req, res)) return

    try {
      const deleted = await deleteTag(req.params.slug)

      if (!deleted) {
        return res.status(404).send({ message: "Tag not found" })
      }

      return res.send({ message: "Tag deleted" })
    } catch (error) {
      console.error("Falha ao apagar a tag:", error)
      return res.status(500).send({ message: "Failed to delete tag" })
    }
  })
}
