// Parâmetros reutilizados pelos paths da spec

export const idParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Id do post",
  schema: { type: "string" }
}

export const commentIdParam = { ...idParam, description: "Id do comentário" }

export const visitorIdHeader = {
  name: "X-Visitor-Id",
  in: "header",
  required: true,
  description:
    "Identificador do visitante, gerado pelo cliente (ex.: um nanoid guardado no navegador)",
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,64}$", example: "V1StGXR8_Z5jdHi6B-myT" }
}

export const tagSlugParam = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug da tag",
  schema: { type: "string", example: "node-js" }
}

export const postSlugParam = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug do post",
  schema: { type: "string", maxLength: 100, example: "testes-com-node-test" }
}
