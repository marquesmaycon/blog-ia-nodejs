// Configuração do postgrator-cli (carregada automaticamente pelo comando `postgrator`).
// O CLI não aceita connection string, então extraímos as partes do DATABASE_URL.
import { existsSync } from "node:fs"

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local")
}

const { DATABASE_URL } = process.env

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL não definida")
}

const url = new URL(DATABASE_URL)

export default {
  driver: "pg",
  host: url.hostname,
  port: url.port || "5432",
  database: url.pathname.slice(1),
  username: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  migrationPattern: "src/db/migrations/*.sql",
  schemaTable: "schema_version"
}
