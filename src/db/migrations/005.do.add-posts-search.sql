-- Busca full-text: título pesa mais (A) que o conteúdo (B) no ts_rank.
-- to_tsvector com a configuração literal é IMMUTABLE, então pode ser coluna gerada.
ALTER TABLE posts ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('portuguese', title), 'A') ||
  setweight(to_tsvector('portuguese', content), 'B')
) STORED;

CREATE INDEX posts_search_idx ON posts USING GIN (search);
