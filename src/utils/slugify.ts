// Gera um slug ASCII para URLs: "Programação Funcional" -> "programacao-funcional".
// Retorna "" quando o texto não tem letras nem dígitos (ex.: "!!!").
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
