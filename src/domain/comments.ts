// Espelha o CHECK da coluna comments.status (migration 002)
export const COMMENT_STATUSES = ["pending", "approved", "rejected"] as const

export type CommentStatus = (typeof COMMENT_STATUSES)[number]

// Espelha o CHECK da coluna comments.author_type (migration 010)
export type CommentAuthorType = "reader" | "ai"

export type Comment = {
  id: string
  post_id: string
  author_name: string
  content: string
  status: CommentStatus
  moderation_reason: string | null
  moderation_categories: string[]
  // Comentário respondido (null nos comentários de primeiro nível)
  parent_id: string | null
  author_type: CommentAuthorType
  created_at: string
}

// O veredito da moderação e a resposta são opcionais: sem eles, valem os defaults da tabela
// (pendente, sem motivo, comentário de leitor no primeiro nível)
export type NewComment = Pick<Comment, "post_id" | "author_name" | "content"> &
  Partial<
    Pick<
      Comment,
      "status" | "moderation_reason" | "moderation_categories" | "parent_id" | "author_type"
    >
  >
