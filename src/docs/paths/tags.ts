import { setPostTagsBodySchema } from "../../routes/tags.schemas.ts"
import { idParam, tagSlugParam } from "../params.ts"
import {
  errorResponse,
  forbiddenResponse,
  messageResponse,
  postResponse,
  validationErrorResponse
} from "../responses.ts"
import { jsonBody } from "../zod.ts"

export const tagPaths = {
  "/posts/{id}/tags": {
    put: {
      tags: ["Tags"],
      summary: "Substitui as tags de um post",
      description:
        "Cria na hora as tags que ainda não existem e substitui o conjunto atual; lista vazia remove todas. Nomes com o mesmo slug viram uma tag só. Funciona em qualquer status do post. Requer API key.",
      parameters: [idParam],
      security: [{ bearerAuth: [] }],
      requestBody: jsonBody(setPostTagsBodySchema),
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
        "200": messageResponse("Tag apagada"),
        "403": forbiddenResponse,
        "404": errorResponse("Tag não encontrada"),
        "500": errorResponse("Falha ao apagar a tag")
      }
    }
  }
}
