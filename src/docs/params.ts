// Parâmetros reutilizados pelos paths da spec

export const idParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Id do post",
  schema: { type: "string" }
}

export const commentIdParam = { ...idParam, description: "Id do comentário" }

export const tagSlugParam = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug da tag",
  schema: { type: "string", example: "node-js" }
}
