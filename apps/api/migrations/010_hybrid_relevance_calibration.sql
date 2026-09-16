ALTER TABLE knowledge_retrieval_configs
  ALTER COLUMN semantic_min_similarity SET DEFAULT 0.82;
UPDATE knowledge_retrieval_configs
  SET semantic_min_similarity=0.82,updated_at=now()
  WHERE semantic_min_similarity=0.72;
