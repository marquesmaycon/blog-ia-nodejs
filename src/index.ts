import { createApp } from "./http/app.ts"
import { registerPostRoutes } from "./routes/posts.ts"

const { API_PORT, API_HOST, API_PROTOCOL } = process.env

const app = createApp()

registerPostRoutes(app)

app.listen({ port: Number(API_PORT ?? 8080), host: API_HOST }, () => {
  console.log(`Server running on ${API_PROTOCOL}://${API_HOST}:${API_PORT}`)
  console.log("Press CTRL+C to stop")
})
