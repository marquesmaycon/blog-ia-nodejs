// Minutos estimados de leitura: palavras separadas por espaço, arredondado para cima.
// Conteúdo vazio ainda conta 1 minuto, para a UI nunca mostrar "0 min".
export function readingTimeMinutes(content: string, wordsPerMinute = 200): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / wordsPerMinute))
}
