-- Identity mapping only. Credentials/provider and session issuance belong to the login delivery.
CREATE TABLE admin_users (
  id uuid PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_memberships (
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES admin_users(id),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id,user_id)
);
CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,user_id) REFERENCES admin_memberships(tenant_id,user_id),
  UNIQUE (tenant_id,id)
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_identity ON admin_users FOR SELECT
  USING (id::text = current_setting('app.admin_user_id',true));
ALTER TABLE admin_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_membership ON admin_memberships FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id',true)
    AND user_id::text = current_setting('app.admin_user_id',true));
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_session_lookup ON admin_sessions FOR SELECT
  USING (token_hash = current_setting('app.admin_token_hash',true));

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT SELECT ON admin_users,admin_memberships,admin_sessions TO support_hub_app;
  END IF;
END $$;
