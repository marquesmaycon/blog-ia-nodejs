// Setup global dos testes de integração e E2E (carregado via --test-global-setup).
// Roda uma única vez no processo principal do runner, antes de qualquer arquivo de teste:
// garante que o banco de teste existe e aplica as migrations.
import pg from "pg"
import Postgrator from "postgrator"

function getTestDatabaseUrl(): URL {
  const { DATABASE_URL } = process.env
  if (!DATABASE_URL) throw new Error("DATABASE_URL não definida (os testes usam o .env.test)")

  const url = new URL(DATABASE_URL)

  // Trava de segurança: os testes truncam tabelas, então nunca rodam fora de um banco *_test
  if (!url.pathname.endsWith("_test")) {
    throw new Error(`Banco de teste deve terminar com "_test", recebido: ${url.pathname.slice(1)}`)
  }

  return url
}

async function createDatabaseIfMissing(url: URL) {
  const database = url.pathname.slice(1)

  const adminUrl = new URL(url)
  adminUrl.pathname = "/postgres"

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()

  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database
    ])
    if (!rowCount) await admin.query(`CREATE DATABASE "${database}"`)
  } finally {
    await admin.end()
  }
}

async function migrate(url: URL) {
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()

  try {
    const postgrator = new Postgrator({
      driver: "pg",
      database: url.pathname.slice(1),
      migrationPattern: "src/db/migrations/*.sql",
      schemaTable: "schema_version",
      execQuery: (query) => client.query(query)
    })

    await postgrator.migrate()
  } finally {
    await client.end()
  }
}

export async function globalSetup() {
  const url = getTestDatabaseUrl()
  await createDatabaseIfMissing(url)
  await migrate(url)
}
