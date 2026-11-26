// Schemas das rotas de curtidas, também usados pela spec em src/docs/paths/likes.ts

import { z } from "zod"

// Gerado pelo cliente (ex.: um nanoid guardado no navegador); identifica o visitante sem login
export const visitorHeaderSchema = z.object({
  "x-visitor-id": z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "Must be 8-64 characters: letters, digits, '_' or '-'")
    .meta({
      description:
        "Identificador do visitante, gerado pelo cliente (ex.: um nanoid guardado no navegador)",
      example: "V1StGXR8_Z5jdHi6B-myT"
    })
})

export const popularPostsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(7)
    .meta({ description: "Tamanho da janela, em dias" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .meta({ description: "Quantidade máxima de posts" })
})
