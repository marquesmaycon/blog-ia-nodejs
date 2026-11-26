import { z } from "zod"

import type { App } from "../http/app.ts"
import { assertApiKey } from "../http/auth.ts"
import { badGateway } from "../http/errors.ts"
import { parseBody } from "../http/validation.ts"
import { generateEditorialIdeas } from "../services/editorial.ts"

const ideasBodySchema = z
  .object({
    count: z.number().int().min(1).max(10).default(5),
    days: z.number().int().min(1).max(365).default(30),
    // Vazio depois do trim vale como "sem foco"
    focus: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => value || undefined)
  })
  // Sem body, valida um objeto vazio: cada campo cai no próprio padrão
  .prefault({})

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
