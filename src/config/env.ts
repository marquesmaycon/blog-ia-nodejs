import { z } from "zod"

// Variáveis de ambiente da aplicação (espelha o .env.example).
//
// Decisões:
// - `env()` é lida sob demanda (parse de `process.env` a cada chamada, sem snapshot no import):
//   os testes alteram `process.env` em runtime.
// - Em runtime, valor inválido cai no default, como antes da centralização. Já o boot
//   (src/index.ts) usa `validateEnv()` e falha cedo listando as variáveis inválidas.
// - String vazia (ex.: `API_KEY=` no .env) conta como variável ausente.
// - Timeouts são inteiros positivos em ms; valores fracionários caem no default.
// - POST_REVIEW_MIN_SCORE aceita de 0 a 10 (antes o 0 caía no default).
// - DATABASE_URL é opcional aqui e só é exigida por getPool() (src/db/index.ts).

const DEFAULT_MODEL = "google/gemini-2.5-flash"

function blankAsUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema)
}

const optionalString = () => blankAsUndefined(z.string().optional())
const model = () => blankAsUndefined(z.string().default(DEFAULT_MODEL))
const timeoutMs = (fallback: number) =>
  blankAsUndefined(z.coerce.number().int().positive().default(fallback))

const shape = {
  API_HOST: optionalString(),
  API_PORT: blankAsUndefined(z.coerce.number().int().min(1).max(65_535).default(8080)),
  API_PROTOCOL: blankAsUndefined(z.string().default("http")),
  API_KEY: optionalString(),
  // URL pública usada nos links do RSS; sem ela, usa API_PROTOCOL://API_HOST:API_PORT
  SITE_URL: optionalString(),
  // true só atrás de um proxy confiável (ver getClientIp em src/http/rate-limit.ts)
  TRUST_PROXY: blankAsUndefined(
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true")
  ),

  POST_WRITER_MODEL: model(),
  COMMENT_MODERATOR_MODEL: model(),
  COMMENT_REPLIER_MODEL: model(),
  POST_REVIEWER_MODEL: model(),
  POST_SEO_MODEL: model(),
  EDITORIAL_PLANNER_MODEL: model(),

  COMMENT_MODERATION_TIMEOUT_MS: timeoutMs(10_000),
  COMMENT_REPLY_TIMEOUT_MS: timeoutMs(20_000),
  POST_REVIEW_TIMEOUT_MS: timeoutMs(30_000),
  POST_SEO_TIMEOUT_MS: timeoutMs(20_000),
  EDITORIAL_IDEAS_TIMEOUT_MS: timeoutMs(60_000),

  POST_REVIEW_MIN_SCORE: blankAsUndefined(z.coerce.number().int().min(0).max(10).default(7)),
  POST_REVIEW_MAX_ATTEMPTS: blankAsUndefined(z.coerce.number().int().positive().default(3)),

  DATABASE_URL: optionalString()
}

const strictSchema = z.object(shape)

// Mesmo shape, mas cada campo inválido vira o valor que ele teria se estivesse ausente
const lenientSchema = z.object(
  Object.fromEntries(
    Object.entries(shape).map(([key, field]: [string, z.ZodType]) => [
      key,
      field.catch(() => field.parse(undefined))
    ])
  )
)

export type Env = z.output<typeof strictSchema>

type EnvSource = Record<string, string | undefined>

export function env(source: EnvSource = process.env): Env {
  return lenientSchema.parse(source) as Env
}

// Lista as variáveis inválidas (`NOME: motivo`); vazia quando o ambiente é válido
export function validateEnv(source: EnvSource = process.env): string[] {
  const result = strictSchema.safeParse(source)
  if (result.success) return []

  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
}
