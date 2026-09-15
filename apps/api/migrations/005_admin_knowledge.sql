CREATE TABLE article_drafts (
  tenant_id text NOT NULL,
  article_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_revision integer CHECK (published_revision > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 200000),
  source_format text NOT NULL CHECK (source_format IN ('text','markdown')),
  source_name text CHECK (source_name IS NULL OR length(source_name) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,article_id),
  FOREIGN KEY (tenant_id,article_id) REFERENCES articles(tenant_id,id)
);

ALTER TABLE article_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON article_drafts
  USING (tenant_id = current_setting('app.tenant_id',true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id',true));

CREATE POLICY admin_session_revoke ON admin_sessions FOR UPDATE
  USING (token_hash = current_setting('app.admin_token_hash',true))
  WITH CHECK (token_hash = current_setting('app.admin_token_hash',true));

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON article_drafts TO support_hub_app;
    GRANT INSERT ON articles,article_versions TO support_hub_app;
    GRANT UPDATE(published_version) ON articles TO support_hub_app;
    GRANT UPDATE(revoked_at) ON admin_sessions TO support_hub_app;
  END IF;
END $$;
