// Schemas das rotas de posts. Ficam fora de posts.ts para a spec OpenAPI importá-los sem os handlers.
// O `.meta()` alimenta a documentação gerada em src/docs/paths/posts.ts.

import { z } from "zod"

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../domain/posts.ts"
import { META_DESCRIPTION_MAX_LENGTH, SUMMARY_MAX_LENGTH } from "../utils/seo.ts"

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createPostDraftBodySchema = z.object({
  idea: z.string().trim().min(1).meta({ example: "Como usar AbortController em Node.js" })
})

// Texto vazio (ou só espaços) limpa o campo, como enviar null; ausente mantém o atual
const optionalSeoText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => value || null)
    .nullable()
    .optional()
    .meta({ description: "Opcional: ausente mantém o atual; null ou texto vazio limpa" })

export const updatePostBodySchema = z.object({
  title: z.string().trim().min(1).max(200).meta({ example: "Novo título" }),
  content: z.string().trim().min(1).meta({ description: "Conteúdo em Markdown" }),
  summary: optionalSeoText(SUMMARY_MAX_LENGTH),
  meta_description: optionalSeoText(META_DESCRIPTION_MAX_LENGTH)
})

export const postSlugSchema = z
  .string()
  .max(100)
  .regex(SLUG_PATTERN, "Must be a post slug (e.g. 'testes-com-node')")
  .meta({ description: "Slug do post", example: "testes-com-node-test" })

// O filtro usa o slug (ex.: "node-js"), o mesmo que aparece em post.tags[].slug
export const listPostsQuerySchema = z.object({
  tag: z
    .string()
    .max(50)
    .regex(SLUG_PATTERN, "Must be a tag slug (e.g. 'node-js')")
    .optional()
    .meta({ description: "Slug da tag para filtrar", example: "node-js" }),
  page: z.coerce.number().int().min(1).default(1).meta({ description: "Página, começando em 1" }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .meta({ description: "Posts por página" }),
  // "q=" ou só espaços contam como busca ausente
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || undefined)
    .meta({
      description:
        'Texto da busca full-text. Aceita sintaxe de buscador: `"frase exata"`, `-excluir`, `or`. Vazio é ignorado.',
      example: "node streams"
    })
})
