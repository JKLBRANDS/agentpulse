#!/usr/bin/env node
/**
 * Downloads the CMS FFM Registration Completion List (RCL),
 * cross-references NPNs against our Supabase agents table,
 * and sets cms_marketplace_registered = true for matches.
 *
 * Data sources:
 *   - 2016–present: TBL_RCL_349.csv
 *   - 2014–2015:    RCL_2014_2015_2.csv
 *
 * Usage: node scripts/load-cms-rcl.mjs
 */

import { createWriteStream, createReadStream, unlinkSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { createInterface } from "readline";
import { Readable } from "stream";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://jzviuripdrrplygkrhwi.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dml1cmlwZHJycGx5Z2tyaHdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA0MTUwMCwiZXhwIjoyMDkwNjE3NTAwfQ.i03XcZXczhW9BolxmW9yQApPq1J_nyxlngd0hDYemok";

const BATCH_SIZE = 25;

const RCL_URLS = [
  "https://data.healthcare.gov/sites/default/files/uploaded_resources/TBL_RCL_349.csv",
  "https://data.healthcare.gov/sites/default/files/uploaded_resources/RCL_2014_2015_2.csv",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a CSV value, stripping quotes and ="..." wrappers */
function cleanField(val) {
  if (!val) return "";
  val = val.trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  if (val.startsWith('="') && val.endsWith('"')) val = val.slice(2, -1);
  return val.trim();
}

/** Simple CSV line splitter that respects quoted fields */
function splitCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Download a file to disk with progress */
async function downloadFile(url, dest) {
  const fname = url.split("/").pop();
  console.log(`  Downloading ${fname} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const fileStream = createWriteStream(dest);
  let downloaded = 0;
  let lastLog = 0;

  const reader = res.body.getReader();
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
        return;
      }
      downloaded += value.length;
      const now = Date.now();
      if (now - lastLog > 5000) {
        const pct = total ? ((downloaded / total) * 100).toFixed(1) : "?";
        console.log(`    ${(downloaded / 1e6).toFixed(1)} MB / ${(total / 1e6).toFixed(1)} MB (${pct}%)`);
        lastLog = now;
      }
      this.push(Buffer.from(value));
    },
  });

  await pipeline(nodeStream, fileStream);
  console.log(`    Done: ${(downloaded / 1e6).toFixed(1)} MB`);
}

/** Read a local CSV file line-by-line, calling fn(fields, headers) for each data row */
async function processCSVFile(filePath, fn) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  let headers = null;
  let count = 0;
  for await (const line of rl) {
    const fields = splitCSVLine(line).map(cleanField);
    if (!headers) {
      headers = fields.map((h) => h.toLowerCase().trim());
      continue;
    }
    fn(fields, headers);
    count++;
    if (count % 500000 === 0) console.log(`    Processed ${(count / 1e6).toFixed(1)}M rows...`);
  }
  return count;
}

/** PATCH agents in Supabase by NPN, batches of BATCH_SIZE in parallel */
async function patchAgentsBatch(npns, body) {
  console.log(`\nPatching ${npns.length} agents in batches of ${BATCH_SIZE}...`);
  let matched = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < npns.length; i += BATCH_SIZE) {
    const batch = npns.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (npn) => {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/agents?npn=eq.${npn}`,
          {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=headers-only",
            },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const range = res.headers.get("content-range");
        if (range && range.includes("0/*")) return "not_found";
        return "ok";
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value === "ok") matched++;
      else if (r.status === "fulfilled" && r.value === "not_found") notFound++;
      else {
        errors++;
        if (errors <= 5) console.error(`    Error: ${r.reason?.message || r.reason}`);
      }
    }

    if (i > 0 && (i / BATCH_SIZE) % 200 === 0) {
      console.log(`    Progress: ${i}/${npns.length} (${matched} matched, ${notFound} not found, ${errors} errors)`);
    }
  }

  return { matched, notFound, errors };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const tmpDir = process.env.TEMP || "/tmp";
  const startTime = Date.now();

  // ── Step 1: Download & parse RCL files ────────────────────────────────
  console.log("\n══════════════════════════════════════════════════");
  console.log("  CMS FFM Registration Completion List Loader");
  console.log("══════════════════════════════════════════════════\n");

  // Collect unique NPNs with their most recent registration info
  // Key = NPN, Value = { planYear, regDate, endDate, npnValid }
  const npnMap = new Map();

  for (const url of RCL_URLS) {
    const fname = url.split("/").pop();
    const dest = `${tmpDir}/${fname}`;

    if (!existsSync(dest)) {
      await downloadFile(url, dest);
    } else {
      console.log(`  Using cached ${fname}`);
    }

    console.log(`  Parsing ${fname} ...`);
    const rowCount = await processCSVFile(dest, (fields, headers) => {
      // Column indices by header name (handles both casing styles)
      const npnIdx = headers.indexOf("npn");
      const yearIdx = headers.findIndex((h) => h.includes("applicable_plan_year") || h.includes("applicable plan year"));
      const regIdx = headers.findIndex((h) => h.includes("individual_registration_completion_date") || h.includes("individual registration completion date"));
      const endIdx = headers.findIndex((h) => h.includes("individual_marketplace_end_date") || h.includes("individual marketplace end date"));
      const validIdx = headers.findIndex((h) => h.includes("npn_valid") || h.includes("npn valid"));

      const npn = fields[npnIdx];
      if (!npn) return;

      const planYear = parseInt(fields[yearIdx] || "0", 10);
      const existing = npnMap.get(npn);

      // Keep the most recent plan year entry per NPN
      if (!existing || planYear > existing.planYear) {
        npnMap.set(npn, {
          planYear,
          regDate: fields[regIdx] || "",
          endDate: fields[endIdx] || "",
          npnValid: (fields[validIdx] || "").trim(),
        });
      }
    });
    console.log(`    ${rowCount.toLocaleString()} rows parsed`);
  }

  console.log(`\n  Total unique NPNs in RCL: ${npnMap.size.toLocaleString()}`);

  // Stats on NPN validity
  let validCount = 0;
  let invalidCount = 0;
  let dashCount = 0;
  for (const [, info] of npnMap) {
    const v = info.npnValid.toUpperCase();
    if (v === "Y") validCount++;
    else if (v === "N") invalidCount++;
    else dashCount++;
  }
  console.log(`  NPN Valid=Y: ${validCount.toLocaleString()}, N: ${invalidCount.toLocaleString()}, -/blank: ${dashCount.toLocaleString()}`);

  // ── Step 2: Update Supabase ───────────────────────────────────────────
  console.log("\n═══ Step 2: Updating Supabase agents ═══");

  const allNpns = Array.from(npnMap.keys());
  const { matched, notFound, errors } = await patchAgentsBatch(
    allNpns,
    { cms_marketplace_registered: true }
  );

  // ── Report ────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n══════════════════════════════════════════════════");
  console.log("  REPORT");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Total NPNs in RCL:          ${npnMap.size.toLocaleString()}`);
  console.log(`  Matched in our agents:       ${matched.toLocaleString()}`);
  console.log(`  Unmatched (not in agents):   ${notFound.toLocaleString()}`);
  console.log(`  Errors:                      ${errors.toLocaleString()}`);
  console.log(`  Elapsed:                     ${elapsed}s`);
  console.log("══════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
