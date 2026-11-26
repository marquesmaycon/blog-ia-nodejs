import { createCommentBodySchema, listCommentsQuerySchema } from "../../routes/comments.schemas.ts"
import { commentIdParam, idParam } from "../params.ts"
import {
  commentListResponse,
  commentResponse,
  errorResponse,
  forbiddenResponse,
  messageResponse,
  tooManyRequestsResponse,
  validationErrorResponse
} from "../responses.ts"
import { jsonBody, queryParams } from "../zod.ts"

export const commentPaths = {
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
      requestBody: jsonBody(createCommentBodySchema),
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
  "/comments": {
    get: {
      tags: ["Comments"],
      summary: "Lista os comentários por status",
      description:
        "Fila de moderação, do mais antigo para o mais recente. Sem `status`, lista os pendentes. Requer API key.",
      parameters: queryParams(listCommentsQuerySchema),
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
        "200": messageResponse("Comentário apagado"),
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
  }
}
