import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { HttpError } from "./errors.ts"
import { ValidationError } from "./validation.ts"

export { HttpError } from "./errors.ts"

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

// Infere os path params a partir do literal da rota: "/posts/:id" -> { id: string }
type ExtractParams<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? { [K in Param]: string } & ExtractParams<`/${Rest}`>
  : Path extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : {}

export type Request<Params = Record<string, string>> = {
  raw: IncomingMessage
  method: string
  path: string
  headers: IncomingMessage["headers"]
  params: Params
  query: URLSearchParams
  body: unknown
}

export type Reply = {
  raw: ServerResponse
  readonly sent: boolean
  status(code: number): Reply
  header(name: string, value: string): Reply
  send(payload?: unknown): void
}

export type Handler<Params = Record<string, string>> = (
  req: Request<Params>,
  res: Reply
) => unknown | Promise<unknown>

// Como a rota responde a um erro inesperado (nem HttpError, nem ValidationError):
// loga com `log` e responde `{ message }` com `status` (padrão 500)
export type RouteErrorOptions = { message: string; log: string; status?: number }

export type RouteOptions = { onError?: RouteErrorOptions }

type Segment = { type: "static"; value: string } | { type: "param"; name: string }

type Route = {
  method: HttpMethod
  // Como foi registrado (ex.: "/posts/:id"); usado para listar as rotas
  path: string
  segments: Segment[]
  handler: Handler<any>
  onError?: RouteErrorOptions
}

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"])

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean)
}

function compilePath(path: string): Segment[] {
  return splitPath(path).map((part) =>
    part.startsWith(":") ? { type: "param", name: part.slice(1) } : { type: "static", value: part }
  )
}

function matchRoute(route: Route, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null

  const params: Record<string, string> = {}

  for (const [index, segment] of route.segments.entries()) {
    const part = parts[index]

    if (segment.type === "static") {
      if (segment.value !== part) return null
      continue
    }

    try {
      params[segment.name] = decodeURIComponent(part)
    } catch {
      return null
    }
  }

  return params
}

// Segmentos estáticos têm prioridade sobre params na mesma posição
// (ex.: "/posts/draft" vence "/posts/:id"), independente da ordem de registro.
function compareSpecificity(a: Route, b: Route): number {
  const length = Math.min(a.segments.length, b.segments.length)

  for (let index = 0; index < length; index++) {
    const typeA = a.segments[index].type
    const typeB = b.segments[index].type
    if (typeA !== typeB) return typeA === "static" ? -1 : 1
  }

  return 0
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)

  const raw = Buffer.concat(chunks).toString()
  if (!raw) return undefined

  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, "Invalid JSON body")
  }
}

function createReply(raw: ServerResponse): Reply {
  let statusCode = 200

  const reply: Reply = {
    raw,
    get sent() {
      return raw.writableEnded
    },
    status(code) {
      statusCode = code
      return reply
    },
    header(name, value) {
      raw.setHeader(name, value)
      return reply
    },
    send(payload) {
      if (raw.writableEnded) return

      if (payload === undefined) {
        raw.writeHead(statusCode)
        raw.end()
        return
      }

      if (typeof payload === "string") {
        if (!raw.hasHeader("Content-Type")) raw.setHeader("Content-Type", "text/plain")
        raw.writeHead(statusCode)
        raw.end(payload)
        return
      }

      raw.setHeader("Content-Type", "application/json")
      raw.writeHead(statusCode)
      raw.end(JSON.stringify(payload))
    }
  }

  return reply
}

export type RegisteredRoute = { method: HttpMethod; path: string }

export function createApp() {
  const routes: Route[] = []

  function addRoute<Path extends string>(
    method: HttpMethod,
    path: Path,
    handler: Handler<ExtractParams<Path>>,
    options: RouteOptions = {}
  ) {
    routes.push({ method, path, segments: compilePath(path), handler, onError: options.onError })
    routes.sort(compareSpecificity)
  }

  async function handle(rawReq: IncomingMessage, rawRes: ServerResponse) {
    const res = createReply(rawRes)
    const url = new URL(rawReq.url ?? "/", "http://localhost")
    const method = rawReq.method ?? "GET"
    const parts = splitPath(url.pathname)

    let matched: { route: Route; params: Record<string, string> } | undefined
    for (const route of routes) {
      if (route.method !== method) continue
      const params = matchRoute(route, parts)
      if (params) {
        matched = { route, params }
        break
      }
    }

    if (!matched) {
      return res.status(404).send({ message: "Not Found" })
    }

    try {
      const req: Request = {
        raw: rawReq,
        method,
        path: url.pathname,
        headers: rawReq.headers,
        params: matched.params,
        query: url.searchParams,
        body: METHODS_WITH_BODY.has(method) ? await readBody(rawReq) : undefined
      }

      const result = await matched.route.handler(req, res)
      if (!res.sent && result !== undefined) res.send(result)
    } catch (error) {
      if (res.sent) {
        console.error("Erro após a resposta ter sido enviada:", error)
        return
      }

      if (error instanceof HttpError) {
        return res.status(error.statusCode).send({ message: error.message, ...error.details })
      }

      if (error instanceof ValidationError) {
        return res.status(400).send({ message: error.message, errors: error.issues })
      }

      const { onError } = matched.route
      if (onError) {
        console.error(onError.log, error)
        return res.status(onError.status ?? 500).send({ message: onError.message })
      }

      console.error(`Erro não tratado em ${method} ${url.pathname}:`, error)
      return res.status(500).send({ message: "Internal Server Error" })
    }
  }

  const server = createServer((req, res) => void handle(req, res))

  return {
    server,
    // Rotas registradas, na ordem de prioridade do roteador (ex.: para conferir a spec OpenAPI)
    routes: (): RegisteredRoute[] => routes.map(({ method, path }) => ({ method, path })),
    get: <Path extends string>(
      path: Path,
      handler: Handler<ExtractParams<Path>>,
      options?: RouteOptions
    ) => addRoute("GET", path, handler, options),
    post: <Path extends string>(
      path: Path,
      handler: Handler<ExtractParams<Path>>,
      options?: RouteOptions
    ) => addRoute("POST", path, handler, options),
    put: <Path extends string>(
      path: Path,
      handler: Handler<ExtractParams<Path>>,
      options?: RouteOptions
    ) => addRoute("PUT", path, handler, options),
    patch: <Path extends string>(
      path: Path,
      handler: Handler<ExtractParams<Path>>,
      options?: RouteOptions
    ) => addRoute("PATCH", path, handler, options),
    delete: <Path extends string>(
      path: Path,
      handler: Handler<ExtractParams<Path>>,
      options?: RouteOptions
    ) => addRoute("DELETE", path, handler, options),
    listen(options: { port: number; host?: string }, callback?: () => void) {
      server.listen(options.port, options.host, callback)
      return server
    }
  }
}

export type App = ReturnType<typeof createApp>
