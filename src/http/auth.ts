import { createHash, timingSafeEqual } from "node:crypto"

import type { Request } from "./app.ts"

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
  const apiKey = process.env.API_KEY
  if (!apiKey) return false

  const token = extractBearerToken(req)
  if (!token) return false

  return safeEqual(token, apiKey)
}
