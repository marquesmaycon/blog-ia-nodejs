// Erro esperado: o handler central responde `{ message, ...details }` com o status dele.
// Uso: `throw notFound("Post not found")` dentro de um handler.
export class HttpError extends Error {
  statusCode: number
  details?: Record<string, unknown>

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "HttpError"
    this.statusCode = statusCode
    this.details = details
  }
}

export const badRequest = (message: string) => new HttpError(400, message)
export const forbidden = () => new HttpError(403, "Forbidden")
export const notFound = (message: string) => new HttpError(404, message)
export const conflict = (message: string) => new HttpError(409, message)
export const unprocessable = (message: string) => new HttpError(422, message)
export const badGateway = (message: string) => new HttpError(502, message)
