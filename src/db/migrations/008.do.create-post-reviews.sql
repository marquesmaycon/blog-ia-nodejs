-- Uma linha por rodada de revisão do rascunho (attempt 1 = primeira versão escrita)
CREATE TABLE post_reviews (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  attempt      INT NOT NULL CHECK (attempt >= 1),
  score        INT NOT NULL CHECK (score BETWEEN 0 AND 10),
  issues       TEXT[] NOT NULL DEFAULT '{}',
  suggestions  TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- O índice da UNIQUE também atende a busca por post_id
  UNIQUE (post_id, attempt)
);
