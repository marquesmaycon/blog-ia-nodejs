import type { App } from "../http/app.ts"
import { getFeed } from "../services/feed.ts"

export function registerFeedRoutes(app: App) {
  app.get(
    "/feed.xml",
    async (_req, res) => {
      const xml = await getFeed()
      return res.header("Content-Type", "application/rss+xml; charset=utf-8").send(xml)
    },
    { onError: { message: "Failed to build feed", log: "Falha ao gerar o feed RSS:" } }
  )
}
