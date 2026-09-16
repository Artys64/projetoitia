import type { Sql } from './database.js'

export async function readTenantMetrics(sql: Sql, tenantId: string) {
  // Legacy fields describe the latest result of each run; attempt totals include retries and expired leases.
  const counts = (await sql.query(`SELECT state,count(*)::int AS count,avg(duration_ms)::int AS average_ms,
    sum(COALESCE((usage->>'totalTokens')::bigint,0))::text AS tokens
    FROM ai_runs WHERE tenant_id=$1 AND created_at>now()-interval '1 day' GROUP BY state`,[tenantId])).rows
  const queue = (await sql.query("SELECT count(*)::int AS pending,extract(epoch FROM now()-min(available_at))::int AS oldest_seconds FROM jobs WHERE tenant_id=$1",[tenantId])).rows[0]
  const reservations = (await sql.query("SELECT actor,reserved_runs FROM usage_buckets WHERE tenant_id=$1 AND day=CURRENT_DATE AND actor='tenant'",[tenantId])).rows
  const attempts = (await sql.query(`SELECT count(*)::int AS count,
    COALESCE(sum((usage->>'totalTokens')::bigint),0)::text AS known_tokens,
    count(*) FILTER (WHERE usage->>'totalTokens' IS NULL)::int AS unknown_usage_count,
    COALESCE(sum((audit#>>'{generation,usage,totalTokens}')::bigint),0)::text AS known_generation_tokens
    FROM ai_run_attempts WHERE tenant_id=$1 AND started_at>now()-interval '1 day'`,[tenantId])).rows[0]
  const publications = (await sql.query(`SELECT state,publication_mode,error_code,
    count(*)::int AS count,avg(duration_ms)::int AS average_ms
    FROM ai_run_attempts WHERE tenant_id=$1 AND started_at>now()-interval '1 day'
    GROUP BY state,publication_mode,error_code`,[tenantId])).rows
  const knowledge = (await sql.query(`SELECT
      count(*) FILTER (WHERE state IN ('queued','running'))::int AS pending,
      count(*) FILTER (WHERE state='failed')::int AS failed,
      COALESCE(sum(completed_chunks),0)::int AS completed_chunks
    FROM knowledge_index_jobs WHERE tenant_id=$1`,[tenantId])).rows[0]
  return { counts, queue, reservations, attempts, publications, knowledge }
}
