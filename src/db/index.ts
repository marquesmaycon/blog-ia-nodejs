import pg from "pg"

const { DATABASE_URL } = process.env

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL não definida")
}

// TIMESTAMPTZ (OID 1184): por padrão o pg devolve Date; convertemos para string ISO
// para manter o contrato do tipo Post (campos de data como string).
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString())

export const pool = new pg.Pool({ connectionString: DATABASE_URL })

// Conexões ociosas podem cair (ex.: restart do Postgres). Sem este listener o evento
// 'error' não tratado derruba o processo; o pool descarta o client e abre outro depois.
pool.on("error", (error) => {
  console.error("Erro em conexão ociosa do Postgres:", error.message)
})
