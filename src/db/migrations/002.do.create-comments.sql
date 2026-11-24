CREATE TABLE comments (
  id                 TEXT PRIMARY KEY,
  post_id            TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_name        TEXT NOT NULL,
  content            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  moderation_reason  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX comments_post_id_created_at_idx ON comments (post_id, created_at);
