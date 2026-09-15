CREATE TABLE ai_run_attempts (
  tenant_id text NOT NULL,
  run_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  lease_token uuid NOT NULL,
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','published','blocked','expired')),
  publication_mode text CHECK (publication_mode IN ('approved','literal','no_guidance','out_of_scope','clarification')),
  error_code text,
  audit jsonb NOT NULL DEFAULT '{}',
  usage jsonb,
  duration_ms integer CHECK (duration_ms >= 0),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (tenant_id,run_id,attempt),
  FOREIGN KEY (tenant_id,run_id) REFERENCES ai_runs(tenant_id,id)
);
CREATE INDEX attempts_started ON ai_run_attempts(tenant_id,started_at);
ALTER TABLE ai_run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_run_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON ai_run_attempts
  USING (tenant_id = current_setting('app.tenant_id',true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id',true));

-- Existing installations can migrate before starting the updated worker.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT SELECT,INSERT,UPDATE ON ai_run_attempts TO support_hub_app;
  END IF;
END $$;
