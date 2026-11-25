import { Mastra } from "@mastra/core/mastra"

import { COMMENT_MODERATOR_AGENT_ID, commentModerator } from "./agents/comment-moderator.ts"
import { POST_WRITER_AGENT_ID, postWriter } from "./agents/post-writer.ts"

export const mastra = new Mastra({
  agents: {
    [POST_WRITER_AGENT_ID]: postWriter,
    [COMMENT_MODERATOR_AGENT_ID]: commentModerator
  }
})
