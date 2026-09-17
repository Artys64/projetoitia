-- Account creation is restricted to the administrative CLI, never the HTTP runtime.
CREATE TABLE admin_credentials (
  username text PRIMARY KEY CHECK (username ~ '^[a-z0-9][a-z0-9._@+-]{2,119}$'),
  user_id uuid NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  password_hash text NOT NULL,
  FOREIGN KEY (tenant_id,user_id) REFERENCES admin_memberships(tenant_id,user_id)
);
ALTER TABLE admin_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_login_lookup ON admin_credentials FOR SELECT
  USING (username = current_setting('app.admin_username',true));

CREATE POLICY admin_session_issue ON admin_sessions FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id',true)
    AND user_id::text = current_setting('app.admin_user_id',true)
    AND token_hash = current_setting('app.admin_token_hash',true)
    AND revoked_at IS NULL
    AND expires_at > now() AND expires_at <= now() + interval '7 days'
    AND EXISTS (SELECT 1 FROM admin_users u WHERE u.id=user_id AND u.active)
    AND EXISTS (SELECT 1 FROM admin_memberships m
      WHERE m.user_id=admin_sessions.user_id AND m.tenant_id=admin_sessions.tenant_id AND m.active)
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.id=tenant_id AND t.active)
  );
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT SELECT ON admin_credentials TO support_hub_app;
    GRANT INSERT ON admin_sessions TO support_hub_app;
  END IF;
END $$;
