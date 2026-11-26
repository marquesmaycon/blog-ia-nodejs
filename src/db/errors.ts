// SQLSTATE do Postgres para violação de UNIQUE (unique_violation)
const UNIQUE_VIOLATION = "23505"

// O erro é uma violação da constraint (ou índice único) informada? Não importa o `pg`:
// checa só o formato do erro, então serve também para erros simulados nos testes.
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION &&
    "constraint" in error &&
    error.constraint === constraint
  )
}
