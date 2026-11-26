import type { App } from "../http/app.ts"
import { assertApiKey } from "../http/auth.ts"
import { badGateway } from "../http/errors.ts"
import { parseBody } from "../http/validation.ts"
import { generateEditorialIdeas } from "../services/editorial.ts"
import { ideasBodySchema } from "./editorial.schemas.ts"

export function registerEditorialRoutes(app: App) {
  app.post(
    "/editorial/ideas",
    async (req) => {
      assertApiKey(req)
      const body = parseBody(req, ideasBodySchema)

      const result = await generateEditorialIdeas(body)
      if (!result.ok) throw badGateway("Failed to generate ideas")

      return { data: { ideas: result.ideas } }
    },
    { onError: { message: "Failed to generate ideas", log: "Falha ao gerar as pautas:" } }
  )
}
