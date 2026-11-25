ALTER TABLE posts
  ADD COLUMN slug TEXT,
  ADD COLUMN reading_time_minutes INT;

-- Backfill dos posts existentes. O slug é uma aproximação em SQL do utils/slugify.ts
-- (translate cobre os acentos do português); colisões ganham sufixo -2, -3...
-- O tempo de leitura segue utils/reading-time.ts: 200 palavras por minuto, mínimo 1.
WITH bases AS (
  SELECT
    id,
    COALESCE(
      NULLIF(
        left(
          trim(BOTH '-' FROM regexp_replace(
            translate(
              lower(title),
              'áàâãäéèêëíìîïóòôõöúùûüçñ',
              'aaaaaeeeeiiiiooooouuuucn'
            ),
            '[^a-z0-9]+', '-', 'g'
          )),
          80
        ),
        ''
      ),
      'post'
    ) AS base,
    published_at
  FROM posts
),
ranked AS (
  SELECT
    id,
    base,
    row_number() OVER (PARTITION BY base ORDER BY published_at, id) AS position
  FROM bases
)
UPDATE posts
SET
  slug = CASE WHEN ranked.position = 1 THEN ranked.base ELSE ranked.base || '-' || ranked.position END,
  reading_time_minutes = GREATEST(
    1,
    CEIL(COALESCE(array_length(regexp_split_to_array(trim(posts.content), '\s+'), 1), 0) / 200.0)
  )
FROM ranked
WHERE ranked.id = posts.id;

ALTER TABLE posts
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN reading_time_minutes SET NOT NULL,
  ADD CONSTRAINT posts_slug_key UNIQUE (slug);
