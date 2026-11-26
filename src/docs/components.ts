// Modelos de resposta (e corpos ainda escritos à mão), referenciados por $ref nos paths

export const schemas = {
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
