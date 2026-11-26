-- Metadados gerados pelo agente post-seo. Nulos nos posts antigos e quando o agente falha:
-- a listagem e o RSS caem no trecho do conteúdo.
ALTER TABLE posts
  ADD COLUMN summary TEXT,
  ADD COLUMN meta_description TEXT;
