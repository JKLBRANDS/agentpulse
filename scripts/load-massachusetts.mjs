#!/usr/bin/env node
/**
 * Downloads Massachusetts DOI Excel files (Life, A&H, P&C agencies),
 * parses them, and upserts into Supabase agencies table.
 * Then cross-references agents table by email domain.
 *
 * Usage: node scripts/load-massachusetts.mjs
 */

import XLSX from "xlsx";
import { existsSync } from "fs";
import os from "os";
import path from "path";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://jzviuripdrrplygkrhwi.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dml1cmlwZHJycGx5Z2tyaHdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA0MTUwMCwiZXhwIjoyMDkwNjE3NTAwfQ.i03XcZXczhW9BolxmW9yQApPq1J_nyxlngd0hDYemok";

const BATCH_SIZE = 50;
const TMP_DIR = os.tmpdir();

const FILES = [
  {
    label: "Life",
    url: "https://www.mass.gov/doc/licensed-life-agenciesxls/download",
    filename: "ma_life.xls",
    hasLifePartner: "yes",
    lineType: "Life",
  },
  {
    label: "A&H",
    url: "https://www.mass.gov/doc/licensed-a-and-h-agenciesxls/download",
    filename: "ma_ah.xls",
    hasLifePartner: "unknown",
    lineType: "Health",
  },
  {
    label: "P&C",
    url: "https://www.mass.gov/doc/licensed-p-and-c-agenciesxlsx/download",
    filename: "ma_pc.xlsx",
    hasLifePartner: "no",
    lineType: "Property & Casualty",
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

/** Download a file to disk via fetch */
async function downloadFile(url, dest) {
  console.log(`  Downloading ${url.split("/").pop()} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import("fs");
  fs.writeFileSync(dest, buf);
  console.log(`    Done: ${(buf.length / 1024).toFixed(0)} KB`);
}

/** Convert Excel serial date to ISO string */
function excelDateToISO(serial) {
  if (!serial || typeof serial !== "number") return null;
  // Excel epoch is Jan 1 1900, but has a leap year bug (+1 day offset for dates after Feb 28 1900)
  const d = new Date((serial - 25569) * 86400000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

/** Clean string value */
function clean(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().replace(/^\t/, "");
  return s || null;
}

/** Parse a single Excel file into an array of agency records */
function parseExcelFile(filePath, fileConfig) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Data starts at row index 6 (row 5 is headers, row 6+ is data)
  const agencies = [];
  for (let i = 6; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 5) continue;

    // Columns: [null, License#/NPN#, OrigApproval, RenewalDate, Agency, Address, City, State, Zip, Phone]
    const licenseNumber = clean(row[1]);
    const originalApproval = excelDateToISO(row[2]);
    const renewalDate = excelDateToISO(row[3]);
    const agencyName = clean(row[4]);
    const address = clean(row[5]);
    const city = clean(row[6]);
    const state = clean(row[7]);
    const zip = clean(row[8]);
    const phone = clean(row[9]);

    if (!agencyName) continue;

    agencies.push({
      licenseNumber,
      originalApproval,
      renewalDate,
      agencyName,
      address,
      city,
      state,
      zip,
      phone,
    });
  }

  console.log(`  ${fileConfig.label}: parsed ${agencies.length} agencies`);
  return agencies;
}

/** Upsert agencies in batches of BATCH_SIZE */
async function upsertBatch(records) {
  console.log(`\nUpserting ${records.length} agencies in batches of ${BATCH_SIZE}...`);
  let success = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/agencies`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const text = await res.text();
      errors += batch.length;
      if (errors <= BATCH_SIZE * 3) {
        console.error(`  Batch error at offset ${i}: HTTP ${res.status} - ${text.slice(0, 200)}`);
      }
    } else {
      const result = await res.json();
      success += result.length;
    }

    if (i > 0 && i % (BATCH_SIZE * 20) === 0) {
      console.log(`  Progress: ${i}/${records.length} (${success} ok, ${errors} errors)`);
    }
  }

  console.log(`  Done: ${success} upserted, ${errors} errors`);
  return { success, errors };
}

/** Fetch all agents with email for domain matching */
async function fetchAgentEmails() {
  console.log("\nFetching agents with emails for domain matching...");
  const allAgents = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agents?select=id,email&email=not.is.null&order=id&offset=${offset}&limit=${pageSize}`,
      { headers }
    );
    if (!res.ok) {
      console.error(`  Error fetching agents: HTTP ${res.status}`);
      break;
    }
    const batch = await res.json();
    if (batch.length === 0) break;
    allAgents.push(...batch);
    offset += batch.length;
    if (batch.length < pageSize) break;
  }

  console.log(`  Found ${allAgents.length} agents with emails`);
  return allAgents;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  // ── Step 1: Download Excel files ──────────────────────────────────────
  console.log("\n=== Step 1: Download Excel Files ===");
  for (const f of FILES) {
    const dest = path.join(TMP_DIR, f.filename);
    if (existsSync(dest)) {
      console.log(`  Using cached: ${f.filename}`);
    } else {
      await downloadFile(f.url, dest);
    }
  }

  // ── Step 2: Parse all files and merge by agency name ──────────────────
  console.log("\n=== Step 2: Parse Excel Files ===");

  // Map: normalized agency name -> merged record
  const agencyMap = new Map();

  for (const fileConfig of FILES) {
    const filePath = path.join(TMP_DIR, fileConfig.filename);
    const agencies = parseExcelFile(filePath, fileConfig);

    for (const a of agencies) {
      const key = a.agencyName.toUpperCase().trim();

      if (agencyMap.has(key)) {
        const existing = agencyMap.get(key);
        // Merge line types
        if (!existing.lineTypes.includes(fileConfig.lineType)) {
          existing.lineTypes.push(fileConfig.lineType);
        }
        // Upgrade has_life_partner: yes > unknown > no
        if (fileConfig.hasLifePartner === "yes") {
          existing.hasLifePartner = "yes";
        } else if (
          fileConfig.hasLifePartner === "unknown" &&
          existing.hasLifePartner === "no"
        ) {
          existing.hasLifePartner = "unknown";
        }
        // Keep earliest license date
        if (
          a.originalApproval &&
          (!existing.originalApproval || a.originalApproval < existing.originalApproval)
        ) {
          existing.originalApproval = a.originalApproval;
        }
        // Fill in missing fields
        if (!existing.phone && a.phone) existing.phone = a.phone;
        if (!existing.address && a.address) existing.address = a.address;
        if (!existing.licenseNumber && a.licenseNumber) existing.licenseNumber = a.licenseNumber;
      } else {
        agencyMap.set(key, {
          ...a,
          lineTypes: [fileConfig.lineType],
          hasLifePartner: fileConfig.hasLifePartner,
        });
      }
    }
  }

  console.log(`\n  Total unique agencies after merge: ${agencyMap.size}`);

  // ── Step 3: Build Supabase records ────────────────────────────────────
  console.log("\n=== Step 3: Build Supabase Records ===");

  const now = new Date();
  const records = [];

  for (const [, a] of agencyMap) {
    const hasLife = a.lineTypes.includes("Life");
    const hasPC = a.lineTypes.includes("Property & Casualty");
    const hasHealth = a.lineTypes.includes("Health");

    let yearsInBusiness = null;
    if (a.originalApproval) {
      const orig = new Date(a.originalApproval);
      yearsInBusiness = Math.floor(
        (now - orig) / (365.25 * 24 * 60 * 60 * 1000)
      );
    }

    records.push({
      entity_name: a.agencyName,
      license_number: a.licenseNumber,
      license_state: "MA",
      license_status: "active",
      original_license_date: a.originalApproval,
      address: a.address,
      city: a.city,
      state: a.state,
      zip: String(a.zip || ""),
      primary_contact_phone: a.phone ? String(a.phone) : null,
      has_life: hasLife,
      has_pc: hasPC,
      has_health: hasHealth,
      has_life_partner: a.hasLifePartner,
      current_lines: a.lineTypes,
      years_in_business: yearsInBusiness,
      agency_model: "unknown",
      is_active: true,
      data_sources: [
        {
          source: "ma_doi_bulk",
          file_types: a.lineTypes,
          imported_at: now.toISOString(),
        },
      ],
    });
  }

  console.log(`  Built ${records.length} records for upsert`);

  // ── Step 4: Upsert into Supabase ─────────────────────────────────────
  console.log("\n=== Step 4: Upsert to Supabase ===");
  const result = await upsertBatch(records);

  // ── Step 5: Cross-reference agents by email domain ────────────────────
  console.log("\n=== Step 5: Cross-reference Agent Email Domains ===");

  // Build a domain -> agency map from agency names/websites
  // We derive possible domains from agency names (e.g., "Acme Insurance" -> "acmeinsurance.com")
  const agents = await fetchAgentEmails();

  // Build set of agency names (lowercased) for matching
  const agencyNameSet = new Map(); // normalized name -> entity_name
  for (const [, a] of agencyMap) {
    const normalized = a.agencyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    agencyNameSet.set(normalized, a.agencyName);
  }

  // Extract unique email domains from agents (skip free email providers)
  const freeProviders = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
    "icloud.com", "mail.com", "protonmail.com", "live.com", "msn.com",
    "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "bellsouth.net",
    "me.com", "ymail.com", "cox.net", "earthlink.net", "charter.net",
  ]);

  // domain -> array of agent ids
  const domainAgents = new Map();
  for (const agent of agents) {
    if (!agent.email) continue;
    const parts = agent.email.toLowerCase().split("@");
    if (parts.length !== 2) continue;
    const domain = parts[1];
    if (freeProviders.has(domain)) continue;
    if (!domainAgents.has(domain)) domainAgents.set(domain, []);
    domainAgents.get(domain).push(agent.id);
  }

  console.log(`  Unique business email domains from agents: ${domainAgents.size}`);

  // Try to match agent email domains to agency names
  // Strategy: strip TLD from domain and see if it matches a normalized agency name
  let matchCount = 0;
  const matchedPairs = []; // { agencyName, domain, agentIds }

  for (const [domain, agentIds] of domainAgents) {
    const domainBase = domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if domain base is a substring of any agency name (or vice versa)
    for (const [normalizedName, originalName] of agencyNameSet) {
      if (
        normalizedName.includes(domainBase) && domainBase.length >= 4 ||
        domainBase.includes(normalizedName) && normalizedName.length >= 4
      ) {
        matchedPairs.push({
          agencyName: originalName,
          domain,
          agentIds,
        });
        matchCount += agentIds.length;
        break;
      }
    }
  }

  console.log(`  Found ${matchedPairs.length} domain matches covering ${matchCount} agents`);

  // Update matched agencies with linked agent info
  if (matchedPairs.length > 0) {
    console.log("  Sample matches:");
    for (const m of matchedPairs.slice(0, 10)) {
      console.log(`    ${m.agencyName} <-> @${m.domain} (${m.agentIds.length} agents)`);
    }

    // For each match, update the agency's data_sources with the linked domain/agents
    for (const m of matchedPairs) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/agencies?entity_name=eq.${encodeURIComponent(m.agencyName)}`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            Prefer: "return=headers-only",
          },
          body: JSON.stringify({
            data_sources: [
              {
                source: "ma_doi_bulk",
                imported_at: now.toISOString(),
              },
              {
                source: "agent_domain_match",
                domain: m.domain,
                matched_agent_count: m.agentIds.length,
                matched_agent_ids: m.agentIds.slice(0, 20), // cap at 20
              },
            ],
          }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.error(`    Error updating ${m.agencyName}: ${text.slice(0, 100)}`);
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Complete in ${elapsed}s ===`);
  console.log(`  Total unique agencies: ${agencyMap.size}`);
  console.log(`  Upserted: ${result.success}`);
  console.log(`  Errors: ${result.errors}`);
  console.log(`  Domain matches: ${matchedPairs.length} agencies, ${matchCount} agents`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
