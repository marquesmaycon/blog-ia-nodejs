import { env } from "../config/env.ts"
import type { Reply, Request } from "./app.ts"

export type RateLimitOptions = {
  max: number
  windowMs: number
  // Relógio injetável para os testes; padrão Date.now
  now?: () => number
}

type Bucket = { count: number; resetAt: number }

// IP do cliente. X-Forwarded-For só é confiável atrás de um proxy (TRUST_PROXY=true);
// sem ele, o cliente poderia forjar o header e ganhar uma cota nova a cada requisição.
export function getClientIp(req: Request<unknown>): string {
  if (env().TRUST_PROXY) {
    const header = req.headers["x-forwarded-for"]
    const forwarded = (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.trim()
    if (forwarded) return forwarded
  }

  return req.raw.socket.remoteAddress ?? "unknown"
}

// Limitador em memória, por IP, com janela fixa. Cada instância é um balde independente.
// Uso: `if (!limiter.check(req, res)) return` (responde 429 e retorna false ao estourar)
export function createRateLimiter({ max, windowMs, now = Date.now }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>()
  let nextSweepAt = now() + windowMs

  // Limpeza preguiçosa das janelas vencidas: sem setInterval, nada segura o processo
  function sweep(current: number) {
    if (current < nextSweepAt) return

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key)
    }
    nextSweepAt = current + windowMs
  }

  function check(req: Request<unknown>, res: Reply): boolean {
    const current = now()
    sweep(current)

    const key = getClientIp(req)
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count++

    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))
    res
      .header("RateLimit-Limit", String(max))
      .header("RateLimit-Remaining", String(Math.max(0, max - bucket.count)))
      .header("RateLimit-Reset", String(resetSeconds))

    if (bucket.count <= max) return true

    res
      .header("Retry-After", String(resetSeconds))
      .status(429)
      .send({ message: "Too Many Requests" })
    return false
  }

  return {
    check,
    // Quantidade de IPs rastreados; exposto para os testes da limpeza
    get size() {
      return buckets.size
    }
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>
