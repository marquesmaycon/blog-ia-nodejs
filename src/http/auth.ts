import { createHash, timingSafeEqual } from "node:crypto"

import { env } from "../config/env.ts"
import type { Request } from "./app.ts"
import { forbidden } from "./errors.ts"

function extractBearerToken(req: Request<unknown>): string | null {
  const header = req.headers.authorization
  if (!header) return null

  const [scheme, token] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== "bearer" || !token) return null

  return token
}

// Compara os hashes para ter tamanho fixo e evitar timing attacks
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest()
  const hashB = createHash("sha256").update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

export function hasValidApiKey(req: Request<unknown>): boolean {
  const apiKey = env().API_KEY
  if (!apiKey) return false

  const token = extractBearerToken(req)
  if (!token) return false

  return safeEqual(token, apiKey)
}

// Guarda para rotas administrativas: lança HttpError 403 (`{ message: "Forbidden" }`)
// Uso: `assertApiKey(req)` no início do handler
export function assertApiKey(req: Request<unknown>): void {
  if (!hasValidApiKey(req)) throw forbidden()
}
