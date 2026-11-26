// Especificação OpenAPI da API, servida em GET /api/docs/json e renderizada pela Swagger UI em GET /api/docs.
// Cada recurso documenta seus paths em src/docs/paths/; os modelos de resposta ficam em components.ts.

import { schemas } from "./components.ts"
import { commentPaths } from "./paths/comments.ts"
import { editorialPaths } from "./paths/editorial.ts"
import { feedPaths } from "./paths/feed.ts"
import { likePaths } from "./paths/likes.ts"
import { postPaths } from "./paths/posts.ts"
import { tagPaths } from "./paths/tags.ts"

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Blog IA API",
    version: "1.0.0",
    description:
      "API de blog em que os posts são escritos por IA. Um agente gera título e conteúdo em Markdown a partir de uma ideia, e o post fica como rascunho até ser aprovado."
  },
  tags: [
    { name: "Posts" },
    { name: "Comments" },
    { name: "Likes" },
    { name: "Tags" },
    { name: "Feed" },
    { name: "Editorial" }
  ],
  paths: {
    ...postPaths,
    ...commentPaths,
    ...likePaths,
    ...tagPaths,
    ...feedPaths,
    ...editorialPaths
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Valor da variável de ambiente `API_KEY`"
      }
    },
    schemas
  }
}
