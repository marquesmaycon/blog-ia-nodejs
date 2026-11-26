import { createHash, timingSafeEqual } from "node:crypto"

import { env } from "../config/env.ts"
import type { Reply, Request } from "./app.ts"

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

// Guarda para rotas administrativas: responde 403 e retorna false quando a API key é inválida.
// Uso: `if (!requireApiKey(req, res)) return`
export function requireApiKey(req: Request<unknown>, res: Reply): boolean {
  if (hasValidApiKey(req)) return true

  res.status(403).send({ message: "Forbidden" })
  return false
}
