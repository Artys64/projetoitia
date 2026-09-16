CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embedding_profiles (
  id text PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  revision text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions = 384),
  metric text NOT NULL CHECK (metric = 'cosine'),
  normalized boolean NOT NULL,
  query_template text NOT NULL,
  passage_template text NOT NULL,
  max_tokens integer NOT NULL CHECK (max_tokens BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO embedding_profiles(
  id,provider,model,revision,dimensions,metric,normalized,
  query_template,passage_template,max_tokens
) VALUES (
  'multilingual-e5-small-v1','local','intfloat/multilingual-e5-small',
  'fd1525a9fd15316a2d503bf26ab031a61d056e98',384,'cosine',true,
  'query: {text}','passage: {text}',512
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE knowledge_retrieval_configs (
  tenant_id text PRIMARY KEY REFERENCES tenants(id),
  strategy text NOT NULL DEFAULT 'hybrid' CHECK (strategy IN ('hybrid')),
  profile_id text NOT NULL REFERENCES embedding_profiles(id),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO knowledge_retrieval_configs(tenant_id,profile_id)
SELECT id,'multilingual-e5-small-v1' FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE knowledge_publications (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  article_id text NOT NULL,
  article_version integer NOT NULL CHECK (article_version > 0),
  draft_revision integer CHECK (draft_revision > 0),
  previous_published_version integer,
  requested_by uuid,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','indexing','ready','active','failed','cancelled','superseded')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,article_id,article_version),
  FOREIGN KEY (tenant_id,article_id,article_version)
    REFERENCES article_versions(tenant_id,article_id,version),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES admin_memberships(tenant_id,user_id)
);
CREATE INDEX knowledge_publications_article
  ON knowledge_publications(tenant_id,article_id,created_at DESC);

CREATE TABLE knowledge_index_sets (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  publication_id uuid NOT NULL,
  article_id text NOT NULL,
  article_version integer NOT NULL CHECK (article_version > 0),
  profile_id text NOT NULL REFERENCES embedding_profiles(id),
  splitter_version text NOT NULL,
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  state text NOT NULL DEFAULT 'building'
    CHECK (state IN ('building','ready','active','retired','failed')),
  expected_chunks integer NOT NULL CHECK (expected_chunks > 0),
  completed_chunks integer NOT NULL DEFAULT 0 CHECK (completed_chunks >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,publication_id),
  FOREIGN KEY (tenant_id,publication_id) REFERENCES knowledge_publications(tenant_id,id),
  FOREIGN KEY (tenant_id,article_id,article_version)
    REFERENCES article_versions(tenant_id,article_id,version)
);
CREATE INDEX knowledge_index_sets_article
  ON knowledge_index_sets(tenant_id,article_id,state,created_at DESC);

CREATE TABLE knowledge_chunks (
  tenant_id text NOT NULL,
  index_set_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  article_id text NOT NULL,
  article_version integer NOT NULL CHECK (article_version > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  section_title text,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 12000),
  token_count integer NOT NULL CHECK (token_count BETWEEN 1 AND 512),
  literal_hash text NOT NULL CHECK (length(literal_hash) = 64),
  embedding_input_hash text NOT NULL CHECK (length(embedding_input_hash) = 64),
  locator jsonb NOT NULL DEFAULT '{}',
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese',coalesce(title,'')),'A') ||
    setweight(to_tsvector('portuguese',coalesce(section_title,'')),'B') ||
    setweight(to_tsvector('portuguese',coalesce(text,'')),'C')
  ) STORED,
  PRIMARY KEY (tenant_id,index_set_id,chunk_index),
  FOREIGN KEY (tenant_id,index_set_id) REFERENCES knowledge_index_sets(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,article_id,article_version)
    REFERENCES article_versions(tenant_id,article_id,version)
);
CREATE INDEX knowledge_chunks_search ON knowledge_chunks USING gin(search_vector);
CREATE INDEX knowledge_chunks_article
  ON knowledge_chunks(tenant_id,article_id,article_version,index_set_id);

CREATE TABLE knowledge_embeddings (
  tenant_id text NOT NULL,
  index_set_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  profile_id text NOT NULL REFERENCES embedding_profiles(id),
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  embedding vector(384) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,index_set_id,chunk_index),
  FOREIGN KEY (tenant_id,index_set_id,chunk_index)
    REFERENCES knowledge_chunks(tenant_id,index_set_id,chunk_index) ON DELETE CASCADE
);
CREATE INDEX knowledge_embeddings_set
  ON knowledge_embeddings(tenant_id,index_set_id,profile_id,chunk_index);

CREATE TABLE knowledge_index_jobs (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  publication_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  completed_chunks integer NOT NULL DEFAULT 0 CHECK (completed_chunks >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,publication_id),
  FOREIGN KEY (tenant_id,publication_id) REFERENCES knowledge_publications(tenant_id,id)
);
CREATE INDEX knowledge_index_jobs_available
  ON knowledge_index_jobs(tenant_id,available_at,id)
  WHERE state IN ('queued','running');

ALTER TABLE articles ADD COLUMN active_index_set_id uuid;
ALTER TABLE articles ADD CONSTRAINT articles_active_index_set_fkey
  FOREIGN KEY (tenant_id,active_index_set_id) REFERENCES knowledge_index_sets(tenant_id,id);
ALTER TABLE messages ADD COLUMN sources jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'knowledge_retrieval_configs','knowledge_publications','knowledge_index_sets',
    'knowledge_chunks','knowledge_embeddings','knowledge_index_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I USING (tenant_id = current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'',true))',
      tab
    );
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN
    GRANT SELECT ON embedding_profiles TO support_hub_app;
    GRANT SELECT,INSERT,UPDATE ON knowledge_retrieval_configs,knowledge_publications,
      knowledge_index_sets,knowledge_chunks,knowledge_embeddings,knowledge_index_jobs TO support_hub_app;
    GRANT DELETE ON knowledge_chunks,knowledge_embeddings TO support_hub_app;
    GRANT UPDATE(active_index_set_id,published_version) ON articles TO support_hub_app;
    GRANT UPDATE(sources) ON messages TO support_hub_app;
  END IF;
END $$;
