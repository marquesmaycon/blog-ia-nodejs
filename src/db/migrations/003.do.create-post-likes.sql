CREATE TABLE post_likes (
  post_id     TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  visitor_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, visitor_id)
);

CREATE INDEX post_likes_created_at_idx ON post_likes (created_at);
