import { createServer } from "node:http"
import { z } from "zod"

import { createPostDraft, getPost, listPosts } from "./services/posts.ts"

const { API_PORT, API_HOST, API_PROTOCOL } = process.env

const createPostDraftBodySchema = z.object({
  idea: z.string().trim().min(1)
})

const server = createServer(async (req, res) => {
  const { url, method } = req
  const paths = url?.split("?").filter(Boolean)
  const path = paths?.at(0) || "/"

  if (path === "/posts" && method === "GET") {
    try {
      const posts = await listPosts()

      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ data: posts }))
    } catch (error) {
      console.error("Falha ao listar os posts:", error)
      res.writeHead(500, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ message: "Failed to list posts" }))
    }
  }

  const postIdMatch = path.match(/^\/posts\/([^/]+)$/)
  if (postIdMatch && method === "GET") {
    const id = postIdMatch[1]

    try {
      const post = await getPost(id)

      if (!post) {
        res.writeHead(404, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ message: "Post not found" }))
      }

      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ data: post }))
    } catch (error) {
      console.error("Falha ao buscar o post:", error)
      res.writeHead(500, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ message: "Failed to get post" }))
    }
  }

  if (path === "/posts/draft" && method === "POST") {
    const bodyBuffer: Buffer[] = []

    req.on("data", (chunk: Buffer) => bodyBuffer.push(chunk))
    req.on("end", async () => {
      const bodyString = Buffer.concat(bodyBuffer).toString()

      let body: unknown
      try {
        body = JSON.parse(bodyString)
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ message: "Invalid JSON body" }))
      }

      const parsed = createPostDraftBodySchema.safeParse(body)
      if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ message: "Field 'idea' is required" }))
      }

      try {
        const post = await createPostDraft(parsed.data.idea)

        res.writeHead(201, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ message: "Post draft created", data: post }))
      } catch (error) {
        console.error("Falha ao gerar o post:", error)
        res.writeHead(502, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ message: "Failed to generate post" }))
      }
    })

    return
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  return res.end(JSON.stringify({ message: "Not Found" }))
})

server.listen(Number(API_PORT ?? 8080), API_HOST, () => {
  console.log(`Server running on ${API_PROTOCOL}://${API_HOST}:${API_PORT}`)
  console.log("Press CTRL+C to stop")
})
