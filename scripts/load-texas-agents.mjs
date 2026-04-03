#!/usr/bin/env node
/**
 * Load Texas individual insurance agent/adjuster data from the TDI Socrata
 * dataset into Supabase agents table.
 *
 * Source: data.texas.gov  "Insurance agents, adjusters, and people approved
 *         to manage insurance-related products or claims"
 * Dataset ID: kxv3-diwf
 * ~944K rows (one row per license held per person, so deduplicate by NPN)
 *
 * Columns available: npn, license_number, name, license_type, qualification,
 *   license_issue_date, expiration_date, city, state, pstl_cd
 *
 * NOTE: No email or phone in the public dataset.
 *
 * Usage: node scripts/load-texas-agents.mjs [--dry-run]
 */

const SUPABASE_URL = "https://jzviuripdrrplygkrhwi.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dml1cmlwZHJycGx5Z2tyaHdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA0MTUwMCwiZXhwIjoyMDkwNjE3NTAwfQ.i03XcZXczhW9BolxmW9yQApPq1J_nyxlngd0hDYemok";

const SOCRATA_BASE = "https://data.texas.gov/resource/kxv3-diwf.json";
const PAGE_SIZE = 5000;
const UPSERT_BATCH = 50;
const DRY_RUN = process.argv.includes("--dry-run");

// License types we care about (skip adjusters by default)
const AGENT_LICENSE_TYPES = new Set([
  "General Lines Agent",
  "Life Agent",
  "Pers Lines Prop and Cas Agent",
  "Surplus Lines Agent",
  "Limited Lines Agent",
  "County Mutual Agent",
  "Managing General Agent",
  "Specialty Insurance Agent",
  "Pre-Need Agent",
]);

// Map TDI qualifications to our boolean flags
function qualificationFlags(qual) {
  const q = (qual || "").toLowerCase();
  return {
    has_life_license:
      q.includes("life") || q.includes("lah") || q.includes("a&h"),
    has_health_license:
      q.includes("health") || q.includes("hmo") || q.includes("a&h"),
    has_pc_license:
      q.includes("property") ||
      q.includes("casualty") ||
      q.includes("p&c") ||
      q.includes("personal lines"),
  };
}

async function fetchAllFromSocrata() {
  const allRecords = [];
  let offset = 0;

  // Only fetch agent license types (skip adjusters, escrow officers, etc.)
  const typeFilter = [...AGENT_LICENSE_TYPES]
    .map((t) => `'${t}'`)
    .join(",");
  const where = `license_type in(${typeFilter})`;

  while (true) {
    const url = `${SOCRATA_BASE}?$limit=${PAGE_SIZE}&$offset=${offset}&$order=:id&$where=${encodeURIComponent(where)}`;
    console.log(`Fetching Socrata offset=${offset}...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Socrata fetch failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    console.log(`  Got ${data.length} records`);
    if (data.length === 0) break;
    allRecords.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`Total Socrata records fetched: ${allRecords.length}`);
  return allRecords;
}

function splitName(fullName) {
  if (!fullName) return { first_name: null, last_name: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: null, last_name: parts[0] };
  // "LAST FIRST MIDDLE" or "FIRST LAST" -- TDI uses "LAST, FIRST MIDDLE" sometimes
  if (fullName.includes(",")) {
    const [last, rest] = fullName.split(",", 2);
    const restParts = (rest || "").trim().split(/\s+/);
    return {
      first_name: restParts[0] || null,
      last_name: last.trim(),
      middle_name: restParts.slice(1).join(" ") || null,
    };
  }
  // Otherwise assume "FIRST LAST"
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function mapRecord(npn, licenses) {
  // Merge multiple license rows for the same NPN
  // Pick the earliest issue date, latest expiration, combine qualifications
  let earliestIssue = null;
  let latestExpiry = null;
  let name = null;
  let city = null;
  let state = null;
  let zip = null;
  let hasLife = false;
  let hasHealth = false;
  let hasPC = false;

  for (const lic of licenses) {
    if (!name && lic.name) name = lic.name;
    if (!city && lic.city) city = lic.city;
    if (!state && lic.state) state = lic.state;
    if (!zip && lic.pstl_cd) zip = lic.pstl_cd;

    if (lic.license_issue_date) {
      const d = lic.license_issue_date.split("T")[0];
      if (!earliestIssue || d < earliestIssue) earliestIssue = d;
    }
    if (lic.expiration_date) {
      const d = lic.expiration_date.split("T")[0];
      if (!latestExpiry || d > latestExpiry) latestExpiry = d;
    }

    const flags = qualificationFlags(lic.qualification);
    if (flags.has_life_license) hasLife = true;
    if (flags.has_health_license) hasHealth = true;
    if (flags.has_pc_license) hasPC = true;
  }

  const { first_name, last_name, middle_name } = splitName(name);
  const now = new Date();
  const isActive = latestExpiry ? new Date(latestExpiry) > now : true;

  let yearsExperience = null;
  if (earliestIssue) {
    yearsExperience = Math.floor(
      (now - new Date(earliestIssue)) / (365.25 * 24 * 60 * 60 * 1000)
    );
  }

  return {
    npn,
    first_name: first_name || null,
    last_name: last_name || null,
    middle_name: middle_name || null,
    mailing_city: city || null,
    mailing_state: state || null,
    mailing_zip: zip || null,
    first_licensed_date: earliestIssue,
    years_experience: yearsExperience,
    is_active: isActive,
    has_life_license: hasLife,
    has_health_license: hasHealth,
    has_pc_license: hasPC,
    data_sources: ["texas-tdi-socrata"],
  };
}

async function upsertBatch(records) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?on_conflict=npn`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(records),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed (${res.status}): ${body}`);
  }
  return res.status;
}

async function main() {
  const startTime = Date.now();
  console.log("\n======================================================");
  console.log("  Texas TDI Individual Agent/Producer Loader");
  console.log("======================================================\n");

  if (DRY_RUN) console.log("  *** DRY RUN -- no Supabase writes ***\n");

  // 1. Fetch all agent records from Socrata
  const raw = await fetchAllFromSocrata();

  // 2. Group by NPN and merge licenses
  const byNpn = new Map();
  let skippedNoNpn = 0;
  for (const r of raw) {
    if (!r.npn) {
      skippedNoNpn++;
      continue;
    }
    if (!byNpn.has(r.npn)) byNpn.set(r.npn, []);
    byNpn.get(r.npn).push(r);
  }

  const mapped = [];
  for (const [npn, licenses] of byNpn) {
    mapped.push(mapRecord(npn, licenses));
  }

  console.log(
    `\nMapped ${mapped.length} unique agents (${raw.length} license rows, ${skippedNoNpn} skipped no NPN)`
  );

  if (DRY_RUN) {
    console.log("\nSample records:");
    for (const r of mapped.slice(0, 3)) {
      console.log(JSON.stringify(r, null, 2));
    }
    console.log(`\nDry run complete. Would upsert ${mapped.length} agents.`);
    return;
  }

  // 3. Upsert in batches
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < mapped.length; i += UPSERT_BATCH) {
    const batch = mapped.slice(i, i + UPSERT_BATCH);
    try {
      await upsertBatch(batch);
      upserted += batch.length;
      if (upserted % 1000 === 0 || i + UPSERT_BATCH >= mapped.length) {
        console.log(`  Upserted ${upserted}/${mapped.length}`);
      }
    } catch (err) {
      console.error(`  Batch error at offset ${i}: ${err.message}`);
      errors += batch.length;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n======================================================");
  console.log("  REPORT");
  console.log("======================================================");
  console.log(`  Source rows:       ${raw.length.toLocaleString()}`);
  console.log(`  Unique agents:     ${mapped.length.toLocaleString()}`);
  console.log(`  Upserted:          ${upserted.toLocaleString()}`);
  console.log(`  Errors:            ${errors.toLocaleString()}`);
  console.log(`  Elapsed:           ${elapsed}s`);
  console.log("======================================================\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
