import { errorResponse } from "../responses.ts"

export const feedPaths = {
  "/feed.xml": {
    get: {
      tags: ["Feed"],
      summary: "Feed RSS dos posts publicados",
      description:
        "RSS 2.0 com os 20 posts aprovados mais recentes. Os links apontam para `/posts/slug/{slug}` a partir de `SITE_URL`.",
      responses: {
        "200": {
          description: "Feed RSS",
          content: { "application/rss+xml": { schema: { type: "string" } } }
        },
        "500": errorResponse("Falha ao gerar o feed")
      }
    }
  }
}
