// Schemas da rota de pauta, também usados pela spec em src/docs/paths/editorial.ts

import { z } from "zod"

export const ideasBodySchema = z
  .object({
    count: z.number().int().min(1).max(10).default(5).meta({ description: "Quantidade de pautas" }),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .meta({ description: "Janela, em dias, das curtidas consideradas" }),
    // Vazio depois do trim vale como "sem foco"
    focus: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => value || undefined)
      .meta({ description: "Tema desejado (opcional)", example: "testes automatizados" })
  })
  // Sem body, valida um objeto vazio: cada campo cai no próprio padrão
  .prefault({})
