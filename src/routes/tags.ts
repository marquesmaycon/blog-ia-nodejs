import { z } from "zod"

import type { App } from "../http/app.ts"
import { assertApiKey } from "../http/auth.ts"
import { notFound } from "../http/errors.ts"
import { parseBody } from "../http/validation.ts"
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
  app.get("/tags", async () => ({ data: await listTags() }), {
    onError: { message: "Failed to list tags", log: "Falha ao listar as tags:" }
  })

  app.put(
    "/posts/:id/tags",
    async (req, res) => {
      assertApiKey(req)
      const { tags } = parseBody(req, setPostTagsBodySchema)

      const post = await setPostTags(req.params.id, tags)
      if (!post) throw notFound("Post not found")

      return res.send({ message: "Post tags updated", data: post })
    },
    {
      onError: { message: "Failed to update post tags", log: "Falha ao atualizar as tags do post:" }
    }
  )

  app.delete(
    "/tags/:slug",
    async (req, res) => {
      assertApiKey(req)

      const deleted = await deleteTag(req.params.slug)
      if (!deleted) throw notFound("Tag not found")

      return res.send({ message: "Tag deleted" })
    },
    { onError: { message: "Failed to delete tag", log: "Falha ao apagar a tag:" } }
  )
}
