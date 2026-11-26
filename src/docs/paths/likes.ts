import { popularPostsQuerySchema, visitorHeaderSchema } from "../../routes/likes.schemas.ts"
import { idParam } from "../params.ts"
import {
  errorResponse,
  likeStatusResponse,
  tooManyRequestsResponse,
  validationErrorResponse
} from "../responses.ts"
import { headerParams, queryParams } from "../zod.ts"

export const likePaths = {
  "/posts/popular": {
    get: {
      tags: ["Likes"],
      summary: "Lista os posts mais curtidos",
      description:
        "Ranking dos posts aprovados pelas curtidas recebidas nos últimos `days` dias. Posts sem curtidas na janela ficam de fora. Empates são desfeitos pelo mais recente.",
      parameters: queryParams(popularPostsQuerySchema),
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
  "/posts/{id}/likes": {
    post: {
      tags: ["Likes"],
      summary: "Curte um post",
      description:
        "Idempotente: cada visitante curte um post uma única vez. Só funciona para posts aprovados. Divide com o DELETE um limite de 30 requisições por minuto por IP.",
      parameters: [idParam, ...headerParams(visitorHeaderSchema)],
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
      parameters: [idParam, ...headerParams(visitorHeaderSchema)],
      responses: {
        "200": likeStatusResponse("Curtida removida"),
        "400": validationErrorResponse("`X-Visitor-Id` ausente ou inválido"),
        "404": errorResponse("Post não encontrado ou não aprovado"),
        "429": tooManyRequestsResponse("Mais de 30 curtidas/descurtidas por minuto do mesmo IP"),
        "500": errorResponse("Falha ao remover a curtida")
      }
    }
  }
}
