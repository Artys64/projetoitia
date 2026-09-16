ALTER TABLE knowledge_retrieval_configs
  ADD COLUMN semantic_min_similarity real NOT NULL DEFAULT 0.72
  CHECK (semantic_min_similarity BETWEEN 0 AND 1);
