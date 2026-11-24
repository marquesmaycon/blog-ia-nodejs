// Especificação OpenAPI da API, servida em GET /api/docs/json e renderizada pela Swagger UI em GET /api/docs.
// Mantenha em sincronia com src/routes/*.ts ao alterar rotas, status ou payloads.

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
})

const validationErrorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } } }
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

const commentIdParam = { ...idParam, description: "Id do comentário" }

const commentResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["message", "data"],
        properties: {
          message: { type: "string" },
          data: { $ref: "#/components/schemas/Comment" }
        }
      }
    }
  }
})

const commentListResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["data"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Comment" } }
        }
      }
    }
  }
})

const visitorIdHeader = {
  name: "X-Visitor-Id",
  in: "header",
  required: true,
  description:
    "Identificador do visitante, gerado pelo cliente (ex.: um nanoid guardado no navegador)",
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,64}$", example: "V1StGXR8_Z5jdHi6B-myT" }
}

const likeStatusResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["message", "data"],
        properties: {
          message: { type: "string" },
          data: { $ref: "#/components/schemas/LikeStatus" }
        }
      }
    }
  }
})

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Blog IA API",
    version: "1.0.0",
    description:
      "API de blog em que os posts são escritos por IA. Um agente gera título e conteúdo em Markdown a partir de uma ideia, e o post fica como rascunho até ser aprovado."
  },
  tags: [{ name: "Posts" }, { name: "Comments" }, { name: "Likes" }],
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
          "400": validationErrorResponse("`idea` ausente ou vazia, ou JSON inválido"),
          "403": forbiddenResponse,
          "502": errorResponse("Falha na geração pelo modelo")
        }
      }
    },
    "/posts/popular": {
      get: {
        tags: ["Likes"],
        summary: "Lista os posts mais curtidos",
        description:
          "Ranking dos posts aprovados pelas curtidas recebidas nos últimos `days` dias. Posts sem curtidas na janela ficam de fora. Empates são desfeitos pelo mais recente.",
        parameters: [
          {
            name: "days",
            in: "query",
            required: false,
            description: "Tamanho da janela, em dias",
            schema: { type: "integer", minimum: 1, maximum: 365, default: 7 }
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Quantidade máxima de posts",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 10 }
          }
        ],
        responses: {
          "200": {
            description: "Posts mais curtidos na janela",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/PopularPost" } }
                  }
                }
              }
            }
          },
          "400": validationErrorResponse("`days` ou `limit` fora do intervalo ou não inteiros"),
          "500": errorResponse("Falha ao listar os posts populares")
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
    },
    "/posts/{id}/comments": {
      get: {
        tags: ["Comments"],
        summary: "Lista os comentários aprovados de um post",
        description: "Do mais antigo para o mais recente. Só funciona para posts aprovados.",
        parameters: [idParam],
        responses: {
          "200": commentListResponse("Comentários aprovados do post"),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "500": errorResponse("Falha ao listar os comentários")
        }
      },
      post: {
        tags: ["Comments"],
        summary: "Comenta um post",
        description:
          "Só aceita comentários em posts aprovados. O comentário nasce com status `pending` e só aparece publicamente depois de aprovado.",
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["author_name", "content"],
                properties: {
                  author_name: { type: "string", minLength: 1, maxLength: 80, example: "Ana" },
                  content: {
                    type: "string",
                    minLength: 1,
                    maxLength: 2000,
                    example: "Ótimo post, obrigado!"
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": commentResponse("Comentário criado e aguardando moderação"),
          "400": validationErrorResponse(
            "Campos ausentes, vazios ou longos demais, ou JSON inválido"
          ),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "500": errorResponse("Falha ao criar o comentário")
        }
      }
    },
    "/posts/{id}/likes": {
      post: {
        tags: ["Likes"],
        summary: "Curte um post",
        description:
          "Idempotente: cada visitante curte um post uma única vez. Só funciona para posts aprovados.",
        parameters: [idParam, visitorIdHeader],
        responses: {
          "201": likeStatusResponse("Curtida registrada"),
          "200": likeStatusResponse("O visitante já tinha curtido o post"),
          "400": validationErrorResponse("`X-Visitor-Id` ausente ou inválido"),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "500": errorResponse("Falha ao curtir o post")
        }
      },
      delete: {
        tags: ["Likes"],
        summary: "Remove a curtida de um post",
        description:
          "Idempotente: responde 200 mesmo que o visitante não tivesse curtido. Só funciona para posts aprovados.",
        parameters: [idParam, visitorIdHeader],
        responses: {
          "200": likeStatusResponse("Curtida removida"),
          "400": validationErrorResponse("`X-Visitor-Id` ausente ou inválido"),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "500": errorResponse("Falha ao remover a curtida")
        }
      }
    },
    "/comments": {
      get: {
        tags: ["Comments"],
        summary: "Lista os comentários por status",
        description:
          "Fila de moderação, do mais antigo para o mais recente. Sem `status`, lista os pendentes. Requer API key.",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["pending", "approved", "rejected"],
              default: "pending"
            }
          }
        ],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": commentListResponse("Comentários com o status informado"),
          "400": validationErrorResponse("`status` inválido"),
          "403": forbiddenResponse,
          "500": errorResponse("Falha ao listar os comentários")
        }
      }
    },
    "/comments/{id}": {
      delete: {
        tags: ["Comments"],
        summary: "Apaga um comentário",
        description: "Remove o comentário definitivamente. Requer API key.",
        parameters: [commentIdParam],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Comentário apagado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: { message: { type: "string" } }
                }
              }
            }
          },
          "403": forbiddenResponse,
          "404": errorResponse("Comentário não encontrado"),
          "500": errorResponse("Falha ao apagar o comentário")
        }
      }
    },
    "/comments/{id}/approve": {
      patch: {
        tags: ["Comments"],
        summary: "Aprova um comentário",
        description: "Define o status como `approved` e limpa `moderation_reason`. Requer API key.",
        parameters: [commentIdParam],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": commentResponse("Comentário aprovado"),
          "403": forbiddenResponse,
          "404": errorResponse("Comentário não encontrado"),
          "500": errorResponse("Falha ao aprovar o comentário")
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
        required: [
          "id",
          "title",
          "content",
          "published_at",
          "approved_at",
          "rejected_at",
          "likes_count",
          "comments_count"
        ],
        properties: {
          id: { type: "string", example: "V1StGXR8_Z5jdHi6B-myT" },
          title: { type: "string", example: "Título do post" },
          content: { type: "string", description: "Conteúdo em Markdown" },
          published_at: { type: "string", format: "date-time" },
          approved_at: { type: ["string", "null"], format: "date-time" },
          rejected_at: { type: ["string", "null"], format: "date-time" },
          likes_count: { type: "integer", minimum: 0, example: 12 },
          comments_count: {
            type: "integer",
            minimum: 0,
            description: "Só comentários aprovados",
            example: 3
          }
        }
      },
      PopularPost: {
        allOf: [
          { $ref: "#/components/schemas/Post" },
          {
            type: "object",
            required: ["recent_likes"],
            properties: {
              recent_likes: {
                type: "integer",
                minimum: 1,
                description: "Curtidas recebidas dentro da janela",
                example: 5
              }
            }
          }
        ]
      },
      LikeStatus: {
        type: "object",
        required: ["post_id", "liked", "likes_count"],
        properties: {
          post_id: { type: "string", example: "V1StGXR8_Z5jdHi6B-myT" },
          liked: { type: "boolean", description: "Se o visitante curte o post após a operação" },
          likes_count: { type: "integer", minimum: 0, example: 12 }
        }
      },
      Comment: {
        type: "object",
        required: [
          "id",
          "post_id",
          "author_name",
          "content",
          "status",
          "moderation_reason",
          "created_at"
        ],
        properties: {
          id: { type: "string", example: "Uakgb_J5m9g-0JDMbcJqL" },
          post_id: { type: "string", example: "V1StGXR8_Z5jdHi6B-myT" },
          author_name: { type: "string", example: "Ana" },
          content: { type: "string", example: "Ótimo post, obrigado!" },
          status: { type: "string", enum: ["pending", "approved", "rejected"] },
          moderation_reason: {
            type: ["string", "null"],
            description: "Motivo da reprovação, quando houver"
          },
          created_at: { type: "string", format: "date-time" }
        }
      },
      ValidationError: {
        type: "object",
        description:
          "Erro de validação. `errors` traz um item por problema; fica ausente quando o JSON do body é inválido.",
        required: ["message"],
        properties: {
          message: { type: "string", example: "Invalid request body" },
          errors: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "message"],
              properties: {
                field: {
                  type: ["string", "null"],
                  description: "Caminho do campo; null quando o erro é no valor inteiro",
                  example: "content"
                },
                message: {
                  type: "string",
                  example: "Too big: expected string to have <=2000 characters"
                }
              }
            }
          }
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
