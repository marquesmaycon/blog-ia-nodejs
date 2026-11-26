import { errorResponse, forbiddenResponse, validationErrorResponse } from "../responses.ts"

export const editorialPaths = {
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
}
