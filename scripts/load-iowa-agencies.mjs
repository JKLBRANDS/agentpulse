// Load Iowa business entity/agency data from Socrata API into Supabase agencies table.

const SUPABASE_URL = 'https://jzviuripdrrplygkrhwi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dml1cmlwZHJycGx5Z2tyaHdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA0MTUwMCwiZXhwIjoyMDkwNjE3NTAwfQ.i03XcZXczhW9BolxmW9yQApPq1J_nyxlngd0hDYemok';
const SOCRATA_URL = 'https://data.iowa.gov/resource/2k8x-8uay.json';
const PAGE_SIZE = 5000;
const UPSERT_BATCH = 50;

async function fetchAllFromSocrata() {
  const allRecords = [];
  let offset = 0;

  while (true) {
    const url = `${SOCRATA_URL}?$limit=${PAGE_SIZE}&$offset=${offset}&$order=:id`;
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

  console.log(`Total Socrata records: ${allRecords.length}`);
  return allRecords;
}

function mapRecord(src) {
  let latitude = null;
  let longitude = null;

  // Extract lat/lng from GeoJSON Point: { type: "Point", coordinates: [lng, lat] }
  if (src.location && src.location.type === 'Point' && Array.isArray(src.location.coordinates)) {
    longitude = src.location.coordinates[0];
    latitude = src.location.coordinates[1];
  }

  // Build address from address1 + address2
  const addressParts = [src.address1, src.address2].filter(Boolean);
  const address = addressParts.length > 0 ? addressParts.join(', ') : null;

  return {
    npn: src.npn || null,
    entity_name: src.entity_name || null,
    primary_contact_email: src.email || null,
    address: address,
    city: src.city || null,
    state: src.state || null,
    zip: src.zip || null,
    latitude: latitude,
    longitude: longitude,
    license_state: 'IA',
    license_status: src.expiry_date && new Date(src.expiry_date) > new Date() ? 'active' : 'expired',
    has_life_partner: 'unknown',
    is_active: true,
    data_sources: ['iowa-socrata'],
  };
}

async function upsertBatch(records) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agencies?on_conflict=npn`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
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
  console.log('Starting Iowa agency data load...');

  // 1. Fetch all records from Socrata
  const raw = await fetchAllFromSocrata();

  // 2. Map to agencies table format, skip records without NPN, deduplicate by NPN (keep latest)
  const byNpn = new Map();
  for (const r of raw) {
    if (!r.npn) continue;
    // Later records overwrite earlier ones (keeps the latest entry per NPN)
    byNpn.set(r.npn, r);
  }
  const mapped = [...byNpn.values()].map(mapRecord);

  console.log(`Mapped ${mapped.length} unique records (${raw.length} total, ${raw.length - byNpn.size} duplicates removed)`);

  // 3. Upsert in batches of 50
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < mapped.length; i += UPSERT_BATCH) {
    const batch = mapped.slice(i, i + UPSERT_BATCH);
    try {
      await upsertBatch(batch);
      upserted += batch.length;
      if (upserted % 500 === 0 || i + UPSERT_BATCH >= mapped.length) {
        console.log(`  Upserted ${upserted}/${mapped.length}`);
      }
    } catch (err) {
      console.error(`  Batch error at offset ${i}: ${err.message}`);
      errors += batch.length;
    }
  }

  console.log(`Done. Upserted: ${upserted}, Errors: ${errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
