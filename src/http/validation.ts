import type { ZodError } from "zod"

import type { Reply } from "./app.ts"

export type ValidationIssue = {
  // Caminho do campo ("content", "tags.0"); null quando o erro é no valor inteiro (ex.: body ausente)
  field: string | null
  message: string
}

// Resposta 400 padrão para falhas de validação do zod, com uma entrada por problema encontrado.
// Uso: `if (!parsed.success) return sendValidationError(res, parsed.error)`
export function sendValidationError(res: Reply, error: ZodError, message = "Invalid request") {
  const errors: ValidationIssue[] = error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : null,
    message: issue.message
  }))

  return res.status(400).send({ message, errors })
}
