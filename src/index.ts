import { env, validateEnv } from "./config/env.ts"
import { createApp } from "./http/app.ts"
import { registerCommentRoutes } from "./routes/comments.ts"
import { registerDocsRoutes } from "./routes/docs.ts"
import { registerEditorialRoutes } from "./routes/editorial.ts"
import { registerFeedRoutes } from "./routes/feed.ts"
import { registerLikeRoutes } from "./routes/likes.ts"
import { registerPostRoutes } from "./routes/posts.ts"
import { registerTagRoutes } from "./routes/tags.ts"

// Falha cedo: em runtime, um valor inválido cairia silenciosamente no default
const envIssues = validateEnv()

if (envIssues.length > 0) {
  const list = envIssues.map((issue) => `  - ${issue}`).join("\n")
  console.error(`Variáveis de ambiente inválidas:\n${list}`)
  process.exit(1)
}

const { API_PORT, API_HOST, API_PROTOCOL } = env()

const app = createApp()

registerDocsRoutes(app)
registerPostRoutes(app)
registerCommentRoutes(app)
registerLikeRoutes(app)
registerTagRoutes(app)
registerFeedRoutes(app)
registerEditorialRoutes(app)

app.listen({ port: API_PORT, host: API_HOST }, () => {
  console.log(`Server running on ${API_PROTOCOL}://${API_HOST}:${API_PORT}`)
  console.log("Press CTRL+C to stop")
})
