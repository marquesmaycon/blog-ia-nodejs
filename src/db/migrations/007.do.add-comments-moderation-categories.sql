ALTER TABLE comments
  ADD COLUMN moderation_categories TEXT[] NOT NULL DEFAULT '{}';
