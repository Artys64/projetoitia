CREATE TABLE tenants (
  id text PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  daily_run_limit integer NOT NULL DEFAULT 200 CHECK (daily_run_limit > 0),
  concurrent_run_limit integer NOT NULL DEFAULT 4 CHECK (concurrent_run_limit > 0)
);
CREATE TABLE installations (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL, greeting text NOT NULL, color text NOT NULL,
  allowed_origins jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id,id)
);
CREATE TABLE visitor_sessions (
  id uuid PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), installation_id text NOT NULL,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,installation_id) REFERENCES installations(tenant_id,id)
);
CREATE INDEX sessions_installation ON visitor_sessions(tenant_id,installation_id);
CREATE TABLE conversations (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, session_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Nova conversa', state text NOT NULL DEFAULT 'ai' CHECK (state IN ('ai','closed','human')),
  next_sequence integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), FOREIGN KEY (tenant_id,session_id) REFERENCES visitor_sessions(tenant_id,id)
);
CREATE INDEX conversations_visitor ON conversations(tenant_id,session_id,created_at DESC,id DESC);
CREATE TABLE messages (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, conversation_id uuid NOT NULL, sequence integer NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
  ai_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,conversation_id,sequence), UNIQUE (ai_run_id),
  FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id)
);
CREATE TABLE ai_runs (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, conversation_id uuid NOT NULL, message_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0, error_code text, model text, prompt_version text,
  sources jsonb NOT NULL DEFAULT '[]', usage jsonb, duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id),
  FOREIGN KEY (tenant_id,message_id) REFERENCES messages(tenant_id,id)
);
ALTER TABLE messages ADD FOREIGN KEY (tenant_id,ai_run_id) REFERENCES ai_runs(tenant_id,id);
CREATE UNIQUE INDEX one_active_run ON ai_runs(tenant_id,conversation_id) WHERE state IN ('queued','running');
CREATE INDEX runs_state ON ai_runs(tenant_id,state,created_at);
CREATE TABLE jobs (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, run_id uuid NOT NULL UNIQUE,
  available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
  FOREIGN KEY (tenant_id,run_id) REFERENCES ai_runs(tenant_id,id)
);
CREATE INDEX jobs_available ON jobs(tenant_id,available_at,lease_until);
CREATE TABLE idempotency_keys (
  tenant_id text NOT NULL, session_id uuid NOT NULL, key text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id,session_id,key),
  FOREIGN KEY (tenant_id,session_id) REFERENCES visitor_sessions(tenant_id,id)
);
CREATE TABLE articles (
  tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, published_version integer,
  PRIMARY KEY (tenant_id,id)
);
CREATE TABLE article_versions (
  tenant_id text NOT NULL, article_id text NOT NULL, version integer NOT NULL CHECK(version>0),
  title text NOT NULL, content text NOT NULL, keywords jsonb NOT NULL, suggestions jsonb NOT NULL,
  PRIMARY KEY (tenant_id,article_id,version), FOREIGN KEY (tenant_id,article_id) REFERENCES articles(tenant_id,id)
);
ALTER TABLE articles ADD FOREIGN KEY (tenant_id,id,published_version) REFERENCES article_versions(tenant_id,article_id,version);
CREATE TABLE usage_buckets (
  tenant_id text NOT NULL REFERENCES tenants(id), day date NOT NULL DEFAULT CURRENT_DATE,
  actor text NOT NULL, reserved_runs integer NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,day,actor)
);
CREATE TABLE session_rate_buckets (
  key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['visitor_sessions','conversations','messages','ai_runs','jobs','idempotency_keys','articles','article_versions','usage_buckets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'',true))',tab);
  END LOOP;
END $$;
-- Before a tenant is known, the only session visible is the one matching the bearer hash.
CREATE POLICY session_lookup ON visitor_sessions FOR SELECT USING (token_hash = current_setting('app.token_hash',true));
