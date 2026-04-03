#!/usr/bin/env node
/**
 * Downloads FL CFO license + appointment CSVs, aggregates by NPN,
 * then PATCHes Supabase agents table in parallel batches of 25.
 *
 * Usage: node scripts/ingest-fl-bulk.mjs
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

const LICENSE_URL =
  "https://www.myfloridacfo.com/downloads/AAS/LicenseeSearch/AllValidLicensesIndividual.csv";
const APPOINTMENT_URLS = [
  "https://www.myfloridacfo.com/downloads/AAS/LicenseeSearch/AllActiveAppointmentsIndividual(A-G).csv",
  "https://www.myfloridacfo.com/downloads/AAS/LicenseeSearch/AllActiveAppointmentsIndividual(H-O).csv",
  "https://www.myfloridacfo.com/downloads/AAS/LicenseeSearch/AllActiveAppointmentsIndividual(P-Z).csv",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a CSV value, stripping quotes and ="..." wrappers */
function cleanField(val) {
  if (!val) return "";
  val = val.trim();
  // Remove surrounding quotes
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  // Remove ="..." wrapper (Excel-style)
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

/** Parse date string like "5/20/1995 12:00:00 AM" → Date */
function parseDate(str) {
  if (!str) return null;
  const cleaned = str.replace(/\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM)/i, "").trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

/** Download a file to disk, showing progress */
async function downloadFile(url, dest) {
  console.log(`  Downloading ${url.split("/").pop()} ...`);
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

/** Read a local CSV file line-by-line, calling fn(fields) for each data row */
async function processCSVFile(filePath, fn) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  let isHeader = true;
  let count = 0;
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const fields = splitCSVLine(line).map(cleanField);
    fn(fields);
    count++;
    if (count % 500000 === 0) console.log(`    Processed ${(count / 1e6).toFixed(1)}M rows...`);
  }
  return count;
}

/** PATCH agents in Supabase by NPN, batches of BATCH_SIZE in parallel */
async function patchAgentsBatch(updates) {
  const npns = Object.keys(updates);
  console.log(`\nPatching ${npns.length} agents in batches of ${BATCH_SIZE}...`);
  let success = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < npns.length; i += BATCH_SIZE) {
    const batch = npns.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (npn) => {
        const body = updates[npn];
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
        // Check if any row was actually updated via content-range
        const range = res.headers.get("content-range");
        if (range && range.includes("0/*")) return "not_found";
        return "ok";
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value === "ok") success++;
      else if (r.status === "fulfilled" && r.value === "not_found") notFound++;
      else {
        errors++;
        if (errors <= 5) console.error(`    Error: ${r.reason?.message || r.reason}`);
      }
    }

    if ((i / BATCH_SIZE) % 100 === 0 && i > 0) {
      console.log(`    Progress: ${i}/${npns.length} (${success} updated, ${notFound} not found, ${errors} errors)`);
    }
  }

  console.log(`  Done: ${success} updated, ${notFound} not found, ${errors} errors`);
  return { success, notFound, errors };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const tmpDir = process.env.TEMP || "/tmp";
  const startTime = Date.now();

  // ── Step 1: Licenses ────────────────────────────────────────────────────
  console.log("\n═══ Step 1: Processing Licenses ═══");
  const licFile = `${tmpDir}/fl_licenses.csv`;

  if (!existsSync(licFile)) {
    await downloadFile(LICENSE_URL, licFile);
  } else {
    console.log("  Using cached license file");
  }

  // Aggregate: for each NPN, find the earliest license issue date
  const npnEarliestDate = new Map(); // NPN → earliest Date
  const rowCount = await processCSVFile(licFile, (fields) => {
    // field 5 = NPN Number, field 10 = License Issue Date
    const npn = fields[5];
    const dateStr = fields[10];
    if (!npn) return;

    const date = parseDate(dateStr);
    if (!date) return;

    const existing = npnEarliestDate.get(npn);
    if (!existing || date < existing) {
      npnEarliestDate.set(npn, date);
    }
  });

  console.log(`  Parsed ${rowCount} license rows → ${npnEarliestDate.size} unique NPNs`);

  // Build update payloads for licenses
  const now = new Date();
  const licenseUpdates = {};
  for (const [npn, earliest] of npnEarliestDate) {
    const yearsExp = Math.floor((now - earliest) / (365.25 * 24 * 60 * 60 * 1000));
    licenseUpdates[npn] = {
      first_licensed_date: earliest.toISOString().split("T")[0],
      years_experience: yearsExp,
    };
  }

  await patchAgentsBatch(licenseUpdates);

  // ── Step 2: Appointments ──────────────────────────────────────────────
  console.log("\n═══ Step 2: Processing Appointments ═══");

  // NPN → Set of company names
  const npnCarriers = new Map();

  for (const url of APPOINTMENT_URLS) {
    const filename = url.split("/").pop().replace(/[()]/g, "_");
    const apptFile = `${tmpDir}/${filename}`;

    if (!existsSync(apptFile)) {
      await downloadFile(url, apptFile);
    } else {
      console.log(`  Using cached: ${filename}`);
    }

    const count = await processCSVFile(apptFile, (fields) => {
      // field 5 = NPN Number, field 9 = company name
      const npn = fields[5];
      const company = fields[9];
      if (!npn || !company) return;

      if (!npnCarriers.has(npn)) npnCarriers.set(npn, new Set());
      npnCarriers.get(npn).add(company);
    });

    console.log(`  Parsed ${count} appointment rows from ${filename}`);
  }

  console.log(`  Total unique NPNs with appointments: ${npnCarriers.size}`);

  // Build update payloads for appointments
  const apptUpdates = {};
  for (const [npn, carriers] of npnCarriers) {
    const carrierList = [...carriers].sort();
    apptUpdates[npn] = {
      data_sources: [
        { source: "fl_ce_bulk" },
        {
          source: "fl_appointments",
          carrier_count: carrierList.length,
          carriers: carrierList,
        },
      ],
    };
  }

  await patchAgentsBatch(apptUpdates);

  // ── Cleanup ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n═══ Complete in ${elapsed} minutes ═══`);
  console.log(`  License NPNs:     ${npnEarliestDate.size}`);
  console.log(`  Appointment NPNs: ${npnCarriers.size}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
