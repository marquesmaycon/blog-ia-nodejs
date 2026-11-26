import type { PostTag } from "./posts.ts"

export type TagWithCount = PostTag & {
  // Só posts aprovados entram na contagem
  posts_count: number
}
