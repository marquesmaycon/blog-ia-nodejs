// Respostas reutilizadas pelos paths da spec. Os modelos referenciados ficam em components.ts.

export const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
})

export const validationErrorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } } }
})

export const forbiddenResponse = errorResponse("API key ausente ou inválida")

export const tooManyRequestsResponse = (description: string) => ({
  ...errorResponse(description),
  headers: {
    "Retry-After": {
      description: "Segundos até a cota do IP ser renovada",
      schema: { type: "integer", example: 42 }
    }
  }
})

export const messageResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string" } }
      }
    }
  }
})

export const postResponse = (description: string, withMessage = false) => ({
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

export const commentResponse = (description: string) => ({
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

export const commentListResponse = (description: string) => ({
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

export const likeStatusResponse = (description: string) => ({
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
