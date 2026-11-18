CREATE TABLE posts (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  rejected_at   TIMESTAMPTZ
);
