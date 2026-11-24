// Especificação OpenAPI da API, servida em GET /api/docs/json e renderizada pela Swagger UI em GET /api/docs.
// Mantenha em sincronia com src/routes/posts.ts ao alterar rotas, status ou payloads.

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
})

const forbiddenResponse = errorResponse("API key ausente ou inválida")

const postResponse = (description: string, withMessage = false) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: withMessage ? ["message", "data"] : ["data"],
        properties: {
          ...(withMessage ? { message: { type: "string" } } : {}),
          data: { $ref: "#/components/schemas/Post" }
        }
      }
    }
  }
})

const idParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Id do post",
  schema: { type: "string" }
}

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Blog IA API",
    version: "1.0.0",
    description:
      "API de blog em que os posts são escritos por IA. Um agente gera título e conteúdo em Markdown a partir de uma ideia, e o post fica como rascunho até ser aprovado."
  },
  tags: [{ name: "Posts" }],
  paths: {
    "/posts": {
      get: {
        tags: ["Posts"],
        summary: "Lista os posts",
        description:
          "Lista os posts aprovados, do mais recente para o mais antigo. Com `include=all`, lista todos os posts (rascunhos e reprovados também) e exige a API key.",
        parameters: [
          {
            name: "include",
            in: "query",
            required: false,
            description: "Use `all` para incluir rascunhos e reprovados (requer API key)",
            schema: { type: "string", enum: ["all"] }
          }
        ],
        security: [{}, { bearerAuth: [] }],
        responses: {
          "200": {
            description: "Lista de posts",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Post" } }
                  }
                }
              }
            }
          },
          "400": errorResponse("`include` com valor diferente de `all`"),
          "403": errorResponse("`include=all` sem API key válida"),
          "500": errorResponse("Falha ao listar os posts")
        }
      }
    },
    "/posts/draft": {
      post: {
        tags: ["Posts"],
        summary: "Gera um rascunho de post a partir de uma ideia",
        description: "Requer API key.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["idea"],
                properties: {
                  idea: {
                    type: "string",
                    minLength: 1,
                    example: "Como usar AbortController em Node.js"
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": postResponse("Post gerado e salvo como rascunho", true),
          "400": errorResponse("`idea` ausente ou vazia, ou JSON inválido"),
          "403": forbiddenResponse,
          "502": errorResponse("Falha na geração pelo modelo")
        }
      }
    },
    "/posts/{id}": {
      get: {
        tags: ["Posts"],
        summary: "Busca um post pelo id",
        description: "Retorna o post independentemente do status.",
        parameters: [idParam],
        responses: {
          "200": postResponse("Post encontrado"),
          "404": errorResponse("Post não encontrado"),
          "500": errorResponse("Falha ao buscar o post")
        }
      }
    },
    "/posts/{id}/approve": {
      patch: {
        tags: ["Posts"],
        summary: "Aprova um post",
        description:
          "Define `approved_at` e `published_at` como agora e limpa `rejected_at`. Requer API key.",
        parameters: [idParam],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": postResponse("Post aprovado", true),
          "403": forbiddenResponse,
          "404": errorResponse("Post não encontrado"),
          "500": errorResponse("Falha ao aprovar o post")
        }
      }
    },
    "/posts/{id}/reject": {
      delete: {
        tags: ["Posts"],
        summary: "Reprova um post",
        description:
          "Define `rejected_at` como agora e limpa `approved_at`. O registro não é apagado. Requer API key.",
        parameters: [idParam],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": postResponse("Post reprovado", true),
          "403": forbiddenResponse,
          "404": errorResponse("Post não encontrado"),
          "500": errorResponse("Falha ao reprovar o post")
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Valor da variável de ambiente `API_KEY`"
      }
    },
    schemas: {
      Post: {
        type: "object",
        required: ["id", "title", "content", "published_at", "approved_at", "rejected_at"],
        properties: {
          id: { type: "string", example: "V1StGXR8_Z5jdHi6B-myT" },
          title: { type: "string", example: "Título do post" },
          content: { type: "string", description: "Conteúdo em Markdown" },
          published_at: { type: "string", format: "date-time" },
          approved_at: { type: ["string", "null"], format: "date-time" },
          rejected_at: { type: ["string", "null"], format: "date-time" }
        }
      },
      Error: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string" } }
      }
    }
  }
}
