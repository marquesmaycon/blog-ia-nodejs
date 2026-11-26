import { postSlugParam, idParam } from "../params.ts"
import {
  errorResponse,
  forbiddenResponse,
  postResponse,
  validationErrorResponse
} from "../responses.ts"

export const postPaths = {
  "/posts": {
    get: {
      tags: ["Posts"],
      summary: "Lista os posts",
      description:
        "Lista os posts aprovados, do mais recente para o mais antigo, em páginas (`page` e `limit`). Com `include=all`, lista todos os posts (rascunhos e reprovados também) e exige a API key. Com `tag`, filtra pelos posts que têm a tag (uma tag inexistente devolve lista vazia). Com `q`, faz busca full-text em português no título e no conteúdo e ordena por relevância (match no título pesa mais). Uma página além do fim devolve `data` vazio com o `total` real.",
      parameters: [
        {
          name: "include",
          in: "query",
          required: false,
          description: "Use `all` para incluir rascunhos e reprovados (requer API key)",
          schema: { type: "string", enum: ["all"] }
        },
        {
          name: "tag",
          in: "query",
          required: false,
          description: "Slug da tag para filtrar",
          schema: {
            type: "string",
            maxLength: 50,
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            example: "node-js"
          }
        },
        {
          name: "q",
          in: "query",
          required: false,
          description:
            'Texto da busca full-text. Aceita sintaxe de buscador: `"frase exata"`, `-excluir`, `or`. Vazio é ignorado.',
          schema: { type: "string", maxLength: 200, example: "node streams" }
        },
        {
          name: "page",
          in: "query",
          required: false,
          description: "Página, começando em 1",
          schema: { type: "integer", minimum: 1, default: 1 }
        },
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Posts por página",
          schema: { type: "integer", minimum: 1, maximum: 50, default: 10 }
        }
      ],
      security: [{}, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Página de posts",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data", "meta"],
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/Post" } },
                  meta: { $ref: "#/components/schemas/PaginationMeta" }
                }
              }
            }
          }
        },
        "400": validationErrorResponse(
          "`include` com valor diferente de `all`, `tag` que não é um slug, `q` com mais de 200 caracteres, ou `page`/`limit` fora dos limites"
        ),
        "403": errorResponse("`include=all` sem API key válida"),
        "500": errorResponse("Falha ao listar os posts")
      }
    }
  },
  "/posts/draft": {
    post: {
      tags: ["Posts"],
      summary: "Gera um rascunho de post a partir de uma ideia",
      description:
        "Roda o workflow `post-drafting`: o agente redator escreve, o revisor dá uma nota de 0 a 10 e, abaixo de `POST_REVIEW_MIN_SCORE` (padrão 7), o redator reescreve com o feedback, até `POST_REVIEW_MAX_ATTEMPTS` (padrão 3) tentativas. A resposta pode levar vários ciclos de LLM. Se o revisor falhar, o último rascunho é salvo sem essa revisão (`review` pode ser `null`). As revisões ficam em `GET /posts/{id}/review`. Por fim, o agente `post-seo` gera `summary`, `meta_description`, o `slug` (ainda sujeito ao sufixo de colisão) e até 5 tags, reaproveitando as que já existem; as tags são aplicadas ao rascunho. Se o agente de SEO falhar, o rascunho é salvo com o slug do título, sem tags e com os metadados nulos. Requer API key.",
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
        "201": {
          description: "Post gerado e salvo como rascunho, com a última revisão da IA",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message", "data"],
                properties: {
                  message: { type: "string", example: "Post draft created" },
                  data: { $ref: "#/components/schemas/PostDraft" }
                }
              }
            }
          }
        },
        "400": validationErrorResponse("`idea` ausente ou vazia, ou JSON inválido"),
        "403": forbiddenResponse,
        "502": errorResponse("Falha na geração pelo modelo redator")
      }
    }
  },
  "/posts/slug/{slug}": {
    get: {
      tags: ["Posts"],
      summary: "Busca um post publicado pelo slug",
      description: "URL pública do post. Rascunhos e reprovados respondem 404.",
      parameters: [postSlugParam],
      responses: {
        "200": postResponse("Post encontrado"),
        "400": validationErrorResponse("Slug em formato inválido"),
        "404": errorResponse("Nenhum post publicado com esse slug"),
        "500": errorResponse("Falha ao buscar o post")
      }
    }
  },
  "/posts/{id}/review": {
    get: {
      tags: ["Posts"],
      summary: "Lista as revisões IA de um post",
      description:
        "Histórico das revisões feitas pelo agente `post-reviewer` durante a geração do rascunho, da primeira tentativa à última. `latest` é a revisão final, ou `null` quando o revisor não respondeu. Requer API key.",
      parameters: [idParam],
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Revisões do post (lista vazia se ele não passou pelo revisor)",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    type: "object",
                    required: ["latest", "history"],
                    properties: {
                      latest: {
                        oneOf: [{ $ref: "#/components/schemas/PostReview" }, { type: "null" }]
                      },
                      history: {
                        type: "array",
                        items: { $ref: "#/components/schemas/PostReview" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "403": forbiddenResponse,
        "404": errorResponse("Post não encontrado"),
        "500": errorResponse("Falha ao buscar as revisões")
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
    },
    put: {
      tags: ["Posts"],
      summary: "Edita um rascunho",
      description:
        "Substitui título e conteúdo de um post ainda não aprovado (rascunho ou reprovado) e, opcionalmente, `summary` e `meta_description`. Recalcula `reading_time_minutes` e, se o título mudou, regera o `slug`. Requer API key.",
      parameters: [idParam],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/UpdatePostBody" } }
        }
      },
      responses: {
        "200": postResponse("Post editado", true),
        "400": validationErrorResponse("`title` ou `content` ausente, vazio ou inválido"),
        "403": forbiddenResponse,
        "404": errorResponse("Post não encontrado"),
        "409": errorResponse("Post já aprovado não pode ser editado"),
        "500": errorResponse("Falha ao editar o post")
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
}
