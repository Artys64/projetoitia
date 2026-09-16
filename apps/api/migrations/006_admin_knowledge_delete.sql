DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT DELETE ON articles,article_versions TO support_hub_app;
  END IF;
END $$;
