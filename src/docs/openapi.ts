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

const tooManyRequestsResponse = (description: string) => ({
  ...errorResponse(description),
  headers: {
    "Retry-After": {
      description: "Segundos até a cota do IP ser renovada",
      schema: { type: "integer", example: 42 }
    }
  }
})

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

const tagSlugParam = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug da tag",
  schema: { type: "string", example: "node-js" }
}

const postSlugParam = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug do post",
  schema: { type: "string", maxLength: 100, example: "testes-com-node-test" }
}

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
          "Só aceita comentários em posts aprovados. Antes de gravar, o agente moderador (IA) avalia o comentário no contexto do post: `approve` publica na hora (`approved`, mensagem `Comment published`), `reject` reprova com motivo e categorias (`rejected`, `Comment rejected`) e `review` deixa para um humano (`pending`, `Comment awaiting moderation`). Se a IA falhar ou estourar o tempo, o comentário fica `pending`. Limite de 5 requisições por minuto por IP.",
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
          "201": commentResponse("Comentário criado com o status decidido pelo moderador"),
          "400": validationErrorResponse(
            "Campos ausentes, vazios ou longos demais, ou JSON inválido"
          ),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "429": tooManyRequestsResponse("Mais de 5 comentários por minuto vindos do mesmo IP"),
          "500": errorResponse("Falha ao criar o comentário")
        }
      }
    },
    "/posts/{id}/likes": {
      post: {
        tags: ["Likes"],
        summary: "Curte um post",
        description:
          "Idempotente: cada visitante curte um post uma única vez. Só funciona para posts aprovados. Divide com o DELETE um limite de 30 requisições por minuto por IP.",
        parameters: [idParam, visitorIdHeader],
        responses: {
          "201": likeStatusResponse("Curtida registrada"),
          "200": likeStatusResponse("O visitante já tinha curtido o post"),
          "400": validationErrorResponse("`X-Visitor-Id` ausente ou inválido"),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "429": tooManyRequestsResponse("Mais de 30 curtidas/descurtidas por minuto do mesmo IP"),
          "500": errorResponse("Falha ao curtir o post")
        }
      },
      delete: {
        tags: ["Likes"],
        summary: "Remove a curtida de um post",
        description:
          "Idempotente: responde 200 mesmo que o visitante não tivesse curtido. Só funciona para posts aprovados. Divide com o POST um limite de 30 requisições por minuto por IP.",
        parameters: [idParam, visitorIdHeader],
        responses: {
          "200": likeStatusResponse("Curtida removida"),
          "400": validationErrorResponse("`X-Visitor-Id` ausente ou inválido"),
          "404": errorResponse("Post não encontrado ou não aprovado"),
          "429": tooManyRequestsResponse("Mais de 30 curtidas/descurtidas por minuto do mesmo IP"),
          "500": errorResponse("Falha ao remover a curtida")
        }
      }
    },
    "/posts/{id}/tags": {
      put: {
        tags: ["Tags"],
        summary: "Substitui as tags de um post",
        description:
          "Cria na hora as tags que ainda não existem e substitui o conjunto atual; lista vazia remove todas. Nomes com o mesmo slug viram uma tag só. Funciona em qualquer status do post. Requer API key.",
        parameters: [idParam],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tags"],
                properties: {
                  tags: {
                    type: "array",
                    maxItems: 10,
                    items: {
                      type: "string",
                      minLength: 1,
                      maxLength: 40,
                      description: "Precisa ter pelo menos uma letra ou dígito"
                    },
                    example: ["Node.js", "IA"]
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": postResponse("Tags do post atualizadas", true),
          "400": validationErrorResponse("`tags` ausente, não é lista ou tem tag inválida"),
          "403": forbiddenResponse,
          "404": errorResponse("Post não encontrado"),
          "500": errorResponse("Falha ao atualizar as tags do post")
        }
      }
    },
    "/tags": {
      get: {
        tags: ["Tags"],
        summary: "Lista as tags em uso",
        description:
          "Só tags com pelo menos um post aprovado, da mais usada para a menos usada e, em caso de empate, pelo nome.",
        responses: {
          "200": {
            description: "Tags com a contagem de posts aprovados",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/TagWithCount" } }
                  }
                }
              }
            }
          },
          "500": errorResponse("Falha ao listar as tags")
        }
      }
    },
    "/tags/{slug}": {
      delete: {
        tags: ["Tags"],
        summary: "Apaga uma tag",
        description: "Remove a tag de todos os posts. Requer API key.",
        parameters: [tagSlugParam],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Tag apagada",
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
          "404": errorResponse("Tag não encontrada"),
          "500": errorResponse("Falha ao apagar a tag")
        }
      }
    },
    "/feed.xml": {
      get: {
        tags: ["Feed"],
        summary: "Feed RSS dos posts publicados",
        description:
          "RSS 2.0 com os 20 posts aprovados mais recentes. Os links apontam para `/posts/slug/{slug}` a partir de `SITE_URL`.",
        responses: {
          "200": {
            description: "Feed RSS",
            content: { "application/rss+xml": { schema: { type: "string" } } }
          },
          "500": errorResponse("Falha ao gerar o feed")
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
    },
    "/comments/{id}/reply": {
      post: {
        tags: ["Comments"],
        summary: "Gera um rascunho de resposta da IA",
        description:
          "O agente `comment-replier` responde a pergunta do leitor usando apenas o conteúdo do post. A resposta é gravada como comentário filho (`parent_id`), com `author_type` `ai` e status `pending`, e só aparece publicamente depois de aprovada em `PATCH /comments/{id}/approve`. Aceita apenas comentários de leitores, de primeiro nível e aprovados, com no máximo um rascunho da IA por comentário. Para gerar de novo, apague o rascunho. Requer API key.",
        parameters: [commentIdParam],
        security: [{ bearerAuth: [] }],
        responses: {
          "201": commentResponse("Rascunho de resposta criado (`Reply draft created`)"),
          "403": forbiddenResponse,
          "404": errorResponse("Comentário não encontrado"),
          "409": errorResponse(
            "Comentário não pode ser respondido (`Comment cannot be replied`: não aprovado, é uma resposta ou o post não está publicado) ou já tem rascunho da IA (`Reply already exists`)"
          ),
          "422": {
            description:
              "O agente concluiu que o comentário não é uma pergunta ou que o post não a responde",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: {
                    message: { type: "string", example: "Comment is not an answerable question" },
                    reason: {
                      type: "string",
                      description: "Justificativa do agente",
                      example: "O comentário é um elogio, não uma pergunta"
                    }
                  }
                }
              }
            }
          },
          "500": errorResponse("Falha ao criar a resposta"),
          "502": errorResponse("O agente falhou ou estourou o tempo (`COMMENT_REPLY_TIMEOUT_MS`)")
        }
      }
    },
    "/editorial/ideas": {
      post: {
        tags: ["Editorial"],
        summary: "Sugere pautas de novos posts",
        description:
          "O agente `editorial-planner` consulta o blog por tools (`getPopularPosts`, `listTags` e `searchPosts`) e sugere posts que aproveitam o engajamento dos leitores sem repetir temas já publicados. O campo `idea` de cada pauta pode ir direto para `POST /posts/draft`. Em `inspired_by` ficam só slugs que as tools de fato devolveram. Requer API key.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EditorialIdeasBody" } }
          }
        },
        responses: {
          "200": {
            description: "Pautas sugeridas",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["ideas"],
                      properties: {
                        ideas: {
                          type: "array",
                          items: { $ref: "#/components/schemas/EditorialIdea" }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": validationErrorResponse("`count`, `days` ou `focus` inválido"),
          "403": forbiddenResponse,
          "500": errorResponse("Falha ao gerar as pautas"),
          "502": errorResponse("O agente falhou ou estourou o tempo (`EDITORIAL_IDEAS_TIMEOUT_MS`)")
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
      PaginationMeta: {
        type: "object",
        required: ["page", "limit", "total"],
        properties: {
          page: { type: "integer", minimum: 1, example: 1 },
          limit: { type: "integer", minimum: 1, maximum: 50, example: 10 },
          total: {
            type: "integer",
            minimum: 0,
            description: "Total de posts que batem com os filtros, sem considerar a paginação",
            example: 42
          }
        }
      },
      Post: {
        type: "object",
        required: [
          "id",
          "slug",
          "title",
          "content",
          "summary",
          "meta_description",
          "reading_time_minutes",
          "published_at",
          "approved_at",
          "rejected_at",
          "likes_count",
          "comments_count",
          "tags"
        ],
        properties: {
          id: { type: "string", example: "V1StGXR8_Z5jdHi6B-myT" },
          slug: {
            type: "string",
            description: "Único, gerado do título; repetidos ganham sufixo (-2, -3...)",
            example: "titulo-do-post"
          },
          title: { type: "string", example: "Título do post" },
          content: { type: "string", description: "Conteúdo em Markdown" },
          summary: {
            type: ["string", "null"],
            maxLength: 300,
            description:
              "Resumo gerado pelo agente de SEO, usado no RSS; null em posts antigos ou se o agente falhou",
            example: "Como processar arquivos grandes sem estourar a memória."
          },
          meta_description: {
            type: ["string", "null"],
            maxLength: 160,
            description: "Descrição para buscadores, gerada pelo agente de SEO",
            example: "Aprenda a usar streams no Node.js."
          },
          reading_time_minutes: {
            type: "integer",
            minimum: 1,
            description: "Estimativa a 200 palavras por minuto",
            example: 4
          },
          published_at: { type: "string", format: "date-time" },
          approved_at: { type: ["string", "null"], format: "date-time" },
          rejected_at: { type: ["string", "null"], format: "date-time" },
          likes_count: { type: "integer", minimum: 0, example: 12 },
          comments_count: {
            type: "integer",
            minimum: 0,
            description: "Só comentários aprovados",
            example: 3
          },
          tags: {
            type: "array",
            description: "Ordenadas pelo nome",
            items: { $ref: "#/components/schemas/Tag" }
          }
        }
      },
      UpdatePostBody: {
        type: "object",
        required: ["title", "content"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200, example: "Novo título" },
          content: { type: "string", minLength: 1, description: "Conteúdo em Markdown" },
          summary: {
            type: ["string", "null"],
            maxLength: 300,
            description: "Opcional: ausente mantém o atual; null ou texto vazio limpa"
          },
          meta_description: {
            type: ["string", "null"],
            maxLength: 160,
            description: "Opcional: ausente mantém o atual; null ou texto vazio limpa"
          }
        }
      },
      Tag: {
        type: "object",
        required: ["name", "slug"],
        properties: {
          name: { type: "string", example: "Node.js" },
          slug: { type: "string", example: "node-js" }
        }
      },
      TagWithCount: {
        allOf: [
          { $ref: "#/components/schemas/Tag" },
          {
            type: "object",
            required: ["posts_count"],
            properties: {
              posts_count: {
                type: "integer",
                minimum: 1,
                description: "Só posts aprovados",
                example: 4
              }
            }
          }
        ]
      },
      PostReview: {
        type: "object",
        required: ["id", "post_id", "attempt", "score", "issues", "suggestions", "created_at"],
        properties: {
          id: { type: "string", example: "Uakgb_J5m9g-0JDMbcJqL" },
          post_id: { type: "string", example: "V1StGXR8_Z5jdHi6B-myT" },
          attempt: {
            type: "integer",
            minimum: 1,
            description: "Tentativa avaliada: 1 é a primeira versão, as seguintes são reescritas",
            example: 2
          },
          score: { type: "integer", minimum: 0, maximum: 10, example: 8 },
          issues: {
            type: "array",
            items: { type: "string" },
            example: ["O exemplo de código não trata erros"]
          },
          suggestions: {
            type: "array",
            items: { type: "string" },
            example: ["Adicione um try/catch ao exemplo de fetch"]
          },
          created_at: { type: "string", format: "date-time" }
        }
      },
      PostDraft: {
        allOf: [
          { $ref: "#/components/schemas/Post" },
          {
            type: "object",
            required: ["review"],
            properties: {
              review: {
                description: "Última revisão da IA; null se o revisor falhou",
                oneOf: [{ $ref: "#/components/schemas/PostReview" }, { type: "null" }]
              }
            }
          }
        ]
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
          "moderation_categories",
          "parent_id",
          "author_type",
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
            description:
              "Motivo dado pelo moderador IA ao reprovar ou ao mandar para revisão humana; null quando aprovado"
          },
          moderation_categories: {
            type: "array",
            items: {
              type: "string",
              enum: ["spam", "toxic", "off-topic", "harassment", "self-promotion", "other"]
            },
            description: "Problemas apontados pelo moderador IA; vazio quando aprovado"
          },
          parent_id: {
            type: ["string", "null"],
            description: "Comentário respondido; null nos comentários de primeiro nível"
          },
          author_type: {
            type: "string",
            enum: ["reader", "ai"],
            description: "`reader` para leitores; `ai` para respostas do agente `comment-replier`"
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
      EditorialIdeasBody: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            default: 5,
            description: "Quantidade de pautas"
          },
          days: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            default: 30,
            description: "Janela, em dias, das curtidas consideradas"
          },
          focus: {
            type: "string",
            maxLength: 200,
            description: "Tema desejado (opcional)",
            example: "testes automatizados"
          }
        }
      },
      EditorialIdea: {
        type: "object",
        required: ["title", "idea", "rationale", "suggested_tags", "inspired_by"],
        properties: {
          title: { type: "string", example: "Testando streams no Node.js com node:test" },
          idea: {
            type: "string",
            description: "Descrição do post, pronta para o body de `POST /posts/draft`",
            example: "Um guia prático de como testar pipelines de streams com node:test e mocks."
          },
          rationale: {
            type: "string",
            example: "O post sobre streams é o mais curtido da semana e tem dúvidas sobre testes."
          },
          suggested_tags: {
            type: "array",
            maxItems: 3,
            items: { type: "string" },
            example: ["Node.js", "Testes"]
          },
          inspired_by: {
            type: "array",
            description: "Slugs dos posts que motivaram a pauta",
            items: { type: "string" },
            example: ["streams-no-nodejs"]
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
