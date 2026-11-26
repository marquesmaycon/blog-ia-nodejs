import type { ZodError } from "zod"

import type { Reply } from "./app.ts"

export type ValidationIssue = {
  // Caminho do campo ("content", "tags.0"); null quando o erro é no valor inteiro (ex.: body ausente)
  field: string | null
  message: string
}

// Uma entrada por problema encontrado pelo zod
export function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : null,
    message: issue.message
  }))
}

// Falha de validação: o handler central responde 400 com `{ message, errors }`
export class ValidationError extends Error {
  zodError: ZodError

  constructor(zodError: ZodError, message = "Invalid request") {
    super(message)
    this.name = "ValidationError"
    this.zodError = zodError
  }

  get issues(): ValidationIssue[] {
    return toValidationIssues(this.zodError)
  }
}

// Resposta 400 padrão para falhas de validação do zod, com uma entrada por problema encontrado.
// Uso: `if (!parsed.success) return sendValidationError(res, parsed.error)`
export function sendValidationError(res: Reply, error: ZodError, message = "Invalid request") {
  return res.status(400).send({ message, errors: toValidationIssues(error) })
}
