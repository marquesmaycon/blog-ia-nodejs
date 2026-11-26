// Schemas das rotas de tags, também usados pela spec em src/docs/paths/tags.ts

import { z } from "zod"

import { slugify } from "../utils/slugify.ts"

export const setPostTagsBodySchema = z.object({
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(40)
        .refine((name) => slugify(name) !== "", "Must contain letters or digits")
        // O refine não aparece no JSON Schema; a descrição documenta a regra
        .meta({ description: "Precisa ter pelo menos uma letra ou dígito" })
    )
    .max(10)
    .meta({ example: ["Node.js", "IA"] })
})
