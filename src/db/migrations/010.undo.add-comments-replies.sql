DROP INDEX comments_ai_reply_per_parent_idx;

ALTER TABLE comments
  DROP COLUMN author_type,
  DROP COLUMN parent_id;
