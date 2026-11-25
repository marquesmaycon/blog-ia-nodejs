import type { App } from "../http/app.ts"
import { getFeed } from "../services/feed.ts"

export function registerFeedRoutes(app: App) {
  app.get("/feed.xml", async (_req, res) => {
    try {
      const xml = await getFeed()
      return res.header("Content-Type", "application/rss+xml; charset=utf-8").send(xml)
    } catch (error) {
      console.error("Falha ao gerar o feed RSS:", error)
      return res.status(500).send({ message: "Failed to build feed" })
    }
  })
}
