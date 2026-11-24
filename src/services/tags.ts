import { findPostById, type Post, type PostTag } from "../repositories/posts.ts"
import {
  deleteTagBySlug,
  findTagsWithApprovedPosts,
  replacePostTags,
  type TagWithCount
} from "../repositories/tags.ts"
import { slugify } from "../utils/slugify.ts"

// Nomes que geram o mesmo slug viram uma tag só; o primeiro nome da lista vence
function toUniqueTags(names: string[]): PostTag[] {
  const bySlug = new Map<string, PostTag>()

  for (const name of names) {
    const slug = slugify(name)
    if (slug && !bySlug.has(slug)) bySlug.set(slug, { name, slug })
  }

  return [...bySlug.values()]
}

// Substitui as tags do post (qualquer status, para o admin taggear rascunhos antes de aprovar).
// Retorna null quando o post não existe.
export async function setPostTags(postId: string, names: string[]): Promise<Post | null> {
  if (!(await findPostById(postId))) return null

  await replacePostTags(postId, toUniqueTags(names))
  return findPostById(postId)
}

export async function listTags(): Promise<TagWithCount[]> {
  return findTagsWithApprovedPosts()
}

// Retorna false quando a tag não existe
export async function deleteTag(slug: string): Promise<boolean> {
  return deleteTagBySlug(slug)
}
