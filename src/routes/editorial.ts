import { z } from "zod"

import type { App } from "../http/app.ts"
import { requireApiKey } from "../http/auth.ts"
import { sendValidationError } from "../http/validation.ts"
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
  app.post("/editorial/ideas", async (req, res) => {
    if (!requireApiKey(req, res)) return

    const parsed = ideasBodySchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error, "Invalid request body")

    try {
      const result = await generateEditorialIdeas(parsed.data)

      if (!result.ok) {
        return res.status(502).send({ message: "Failed to generate ideas" })
      }

      return res.send({ data: { ideas: result.ideas } })
    } catch (error) {
      console.error("Falha ao gerar as pautas:", error)
      return res.status(500).send({ message: "Failed to generate ideas" })
    }
  })
}
