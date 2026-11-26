import pg from "pg"

import { env } from "../config/env.ts"

// TIMESTAMPTZ (OID 1184): por padrão o pg devolve Date; convertemos para string ISO
// para manter o contrato do tipo Post (campos de data como string).
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString())

let pool: pg.Pool | undefined

// Cria o pool na primeira chamada: importar este módulo não exige DATABASE_URL,
// só usar o banco. Assim, quem importa repositórios (ex.: as tools do Mastra) não
// depende do banco para carregar, inclusive nos testes unitários.
export function getPool(): pg.Pool {
  if (pool) return pool

  const { DATABASE_URL } = env()

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL não definida")
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL })

  // Conexões ociosas podem cair (ex.: restart do Postgres). Sem este listener o evento
  // 'error' não tratado derruba o processo; o pool descarta o client e abre outro depois.
  pool.on("error", (error) => {
    console.error("Erro em conexão ociosa do Postgres:", error.message)
  })

  return pool
}

// O pool ou o client de uma transação: repositórios que aceitam participar de uma
// transação recebem este tipo e usam o pool (getPool) como padrão
export type Queryable = Pick<pg.Pool, "query">

// Executa `fn` numa transação: COMMIT se resolver, ROLLBACK se lançar (e relança o erro).
// Todas as queries da transação precisam usar o `client` recebido, não o pool.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()

  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
