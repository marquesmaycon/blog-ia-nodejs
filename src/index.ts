import { createApp } from "./http/app.ts"
import { registerCommentRoutes } from "./routes/comments.ts"
import { registerDocsRoutes } from "./routes/docs.ts"
import { registerEditorialRoutes } from "./routes/editorial.ts"
import { registerFeedRoutes } from "./routes/feed.ts"
import { registerLikeRoutes } from "./routes/likes.ts"
import { registerPostRoutes } from "./routes/posts.ts"
import { registerTagRoutes } from "./routes/tags.ts"

const { API_PORT, API_HOST, API_PROTOCOL } = process.env

const app = createApp()

registerDocsRoutes(app)
registerPostRoutes(app)
registerCommentRoutes(app)
registerLikeRoutes(app)
registerTagRoutes(app)
registerFeedRoutes(app)
registerEditorialRoutes(app)

app.listen({ port: Number(API_PORT ?? 8080), host: API_HOST }, () => {
  console.log(`Server running on ${API_PROTOCOL}://${API_HOST}:${API_PORT}`)
  console.log("Press CTRL+C to stop")
})
