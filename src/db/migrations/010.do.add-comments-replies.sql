-- Respostas a comentários: hoje só o agente comment-replier responde, sempre como rascunho
-- (status 'pending') que o admin aprova. Apagar o comentário pai apaga a resposta.
ALTER TABLE comments
  ADD COLUMN parent_id   TEXT REFERENCES comments (id) ON DELETE CASCADE,
  ADD COLUMN author_type TEXT NOT NULL DEFAULT 'reader'
                         CHECK (author_type IN ('reader', 'ai'));

-- No máximo um rascunho da IA por comentário, mesmo com requisições concorrentes
CREATE UNIQUE INDEX comments_ai_reply_per_parent_idx
  ON comments (parent_id) WHERE author_type = 'ai';
