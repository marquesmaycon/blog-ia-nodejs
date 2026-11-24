CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  -- Identidade da tag: nomes que geram o mesmo slug ("Node.js", "node js") são a mesma tag
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE post_tags (
  post_id  TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- A PK cobre a busca por post; este índice cobre o filtro por tag
CREATE INDEX post_tags_tag_id_idx ON post_tags (tag_id);
