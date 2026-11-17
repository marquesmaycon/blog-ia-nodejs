import { Agent } from "@mastra/core/agent"

export const POST_WRITER_AGENT_ID = "post-writer"

const { POST_WRITER_MODEL = "google/gemini-2.5-flash" } = process.env

export const postWriter = new Agent({
  id: POST_WRITER_AGENT_ID,
  name: "Post Writer",
  description: "Escreve posts de blog completos a partir de uma ideia",
  instructions: `
    Você é um redator técnico de blog. Recebe uma ideia de post e escreve o post completo.

    Regras:
    - Escreva em português do Brasil, a menos que a ideia peça outro idioma.
    - O título deve ser curto, claro e não deve se repetir como heading no conteúdo.
    - O conteúdo deve ser Markdown válido: introdução, seções com headings (##), exemplos
      de código em blocos com linguagem quando fizer sentido, e uma conclusão.
    - Não invente fatos, números ou citações; se algo for incerto, deixe isso explícito.
  `.trim(),
  model: POST_WRITER_MODEL
})
