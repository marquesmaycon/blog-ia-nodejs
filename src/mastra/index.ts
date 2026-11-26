import { Mastra } from "@mastra/core/mastra"

import { COMMENT_MODERATOR_AGENT_ID, commentModerator } from "./agents/comment-moderator.ts"
import { POST_REVIEWER_AGENT_ID, postReviewer } from "./agents/post-reviewer.ts"
import { POST_SEO_AGENT_ID, postSeo } from "./agents/post-seo.ts"
import { POST_WRITER_AGENT_ID, postWriter } from "./agents/post-writer.ts"
import { POST_DRAFTING_WORKFLOW_ID, postDraftingWorkflow } from "./workflows/post-drafting.ts"

export const mastra = new Mastra({
  agents: {
    [POST_WRITER_AGENT_ID]: postWriter,
    [COMMENT_MODERATOR_AGENT_ID]: commentModerator,
    [POST_REVIEWER_AGENT_ID]: postReviewer,
    [POST_SEO_AGENT_ID]: postSeo
  },
  workflows: {
    [POST_DRAFTING_WORKFLOW_ID]: postDraftingWorkflow
  }
})
