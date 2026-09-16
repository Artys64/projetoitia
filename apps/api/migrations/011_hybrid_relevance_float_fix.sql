UPDATE knowledge_retrieval_configs
  SET semantic_min_similarity=0.82,updated_at=now()
  WHERE semantic_min_similarity<0.82;
