import { Mastra } from "@mastra/core/mastra"

import { POST_WRITER_AGENT_ID, postWriter } from "./agents/post-writer.ts"

export const mastra = new Mastra({
  agents: { [POST_WRITER_AGENT_ID]: postWriter }
})
