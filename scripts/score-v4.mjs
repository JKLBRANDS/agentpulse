#!/usr/bin/env node
/**
 * Runs V4 scoring on all active agents in 10K batches.
 */

const SUPABASE_URL = "https://jzviuripdrrplygkrhwi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dml1cmlwZHJycGx5Z2tyaHdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA0MTUwMCwiZXhwIjoyMDkwNjE3NTAwfQ.i03XcZXczhW9BolxmW9yQApPq1J_nyxlngd0hDYemok";

const BATCH = 10000;
const TOTAL = 486000;

async function runSQL(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  // Use the SQL endpoint instead
  const r = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`SQL error: ${r.status} ${text}`);
  }
  return r.json();
}

function buildQuery(offset) {
  return `
WITH scored AS (
  SELECT a.id,
    LEAST(100, GREATEST(0,
      CASE WHEN a.has_life_license THEN 20 ELSE 0 END +
      CASE WHEN a.has_health_license THEN 5 ELSE 0 END +
      CASE WHEN a.has_pc_license THEN 5 ELSE 0 END +
      CASE WHEN a.has_life_license AND a.has_health_license THEN 5 ELSE 0 END +
      CASE WHEN a.email IS NOT NULL THEN 5 ELSE 0 END +
      CASE WHEN a.phone IS NOT NULL THEN 5 ELSE 0 END +
      CASE WHEN a.years_experience BETWEEN 2 AND 3 THEN 5
           WHEN a.years_experience BETWEEN 4 AND 7 THEN 15
           WHEN a.years_experience BETWEEN 8 AND 15 THEN 25
           WHEN a.years_experience BETWEEN 16 AND 25 THEN 20
           WHEN a.years_experience > 25 THEN 10 ELSE 0 END
    )) as qs,
    LEAST(100, GREATEST(0,
      CASE WHEN a.agent_type='independent' AND a.has_life_license THEN 25
           WHEN a.agent_type='independent' AND NOT a.has_life_license THEN 30
           WHEN a.agent_type='captive' THEN 15 ELSE 10 END +
      CASE WHEN NOT a.has_life_license AND (a.has_pc_license OR a.has_health_license) THEN 20 ELSE 0 END +
      CASE WHEN a.years_experience BETWEEN 3 AND 7 THEN 15
           WHEN a.years_experience BETWEEN 8 AND 15 THEN 10
           WHEN a.years_experience BETWEEN 16 AND 25 THEN 5 ELSE 0 END +
      CASE WHEN a.cms_marketplace_registered THEN 5 ELSE 0 END
    )) as rs
  FROM agents a WHERE a.is_active ORDER BY a.id LIMIT ${BATCH} OFFSET ${offset}
)
INSERT INTO agent_scores (agent_id, quality_score, receptivity_score, composite_score, tier, score_version)
SELECT id, qs, rs, (qs*0.4+rs*0.6)::int,
  (CASE WHEN (qs*0.4+rs*0.6)>=55 THEN 'A' WHEN (qs*0.4+rs*0.6)>=40 THEN 'B' WHEN (qs*0.4+rs*0.6)>=25 THEN 'C' ELSE 'D' END)::score_tier, 4
FROM scored
ON CONFLICT (agent_id) DO UPDATE SET
  quality_score=EXCLUDED.quality_score, receptivity_score=EXCLUDED.receptivity_score,
  composite_score=EXCLUDED.composite_score, tier=EXCLUDED.tier, score_version=4, scored_at=now();`;
}

async function main() {
  console.log("Starting V4 scoring...");
  // Already scored batch 0 via MCP, start from 10000
  for (let offset = 10000; offset < TOTAL; offset += BATCH) {
    try {
      await runSQL(buildQuery(offset));
      console.log(`  Scored ${offset + BATCH}/${TOTAL}`);
    } catch (err) {
      console.error(`  Error at offset ${offset}: ${err.message}`);
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 2000));
        await runSQL(buildQuery(offset));
        console.log(`  Retry OK: ${offset + BATCH}/${TOTAL}`);
      } catch (err2) {
        console.error(`  Retry failed at ${offset}: ${err2.message}`);
      }
    }
  }
  console.log("Done!");
}

main().catch(console.error);
