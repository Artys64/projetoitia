DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT DELETE ON knowledge_publications,knowledge_index_sets,knowledge_index_jobs TO support_hub_app;
  END IF;
END $$;
