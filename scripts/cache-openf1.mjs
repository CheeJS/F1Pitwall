/**
 * cache-openf1.mjs
 *
 * Downloads all historical OpenF1 session data and uploads it to S3.
 * Each session gets a folder:  s3://{BUCKET}/{session_key}/{endpoint}.json
 *
 * Usage:
 *   node scripts/cache-openf1.mjs [--years 2023,2024,2025] [--dry-run]
 *   node scripts/cache-openf1.mjs --years 2025 --skip-location --skip-car-data
 *
 * Env vars required:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION           (e.g. ap-southeast-2)
 *   S3_BUCKET            (e.g. 1pitwall-cache)
 *
 * Install deps once:
 *   npm install --save-dev @aws-sdk/client-s3
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load .env from F1PitWall.Web/.env ────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dirname, '../F1PitWall.Web/.env');
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  });
} catch { /* .env not found — rely on shell env */ }

// ── Config ────────────────────────────────────────────────

const YEARS = (process.argv.find(a => a.startsWith('--years='))?.split('=')[1] ?? '2023,2024,2025')
  .split(',').map(Number);
const DRY_RUN      = process.argv.includes('--dry-run');
const SKIP_LOC     = process.argv.includes('--skip-location');
const SKIP_CARDATA = process.argv.includes('--skip-car-data');
// Concurrency: how many chunk requests to run in parallel.
// OpenF1 rate-limits aggressively — keep this low (1-2) unless you have an API key.
const CONCURRENCY  = Number(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '2');

const BASE         = 'https://api.openf1.org/v1';
const S3_BUCKET    = process.env.S3_BUCKET ?? process.env.S3_PREDICTIONS_BUCKET;
const AWS_REGION   = process.env.AWS_REGION ?? 'ap-southeast-2';
const OPENF1_API_KEY = process.env.OPENF1_API_KEY ?? '';

if (!S3_BUCKET && !DRY_RUN) {
  console.error('S3_BUCKET env var required');
  process.exit(1);
}

// ── Endpoint lists ────────────────────────────────────────

// Simple endpoints: one request per session, returns all drivers combined.
const SIMPLE_ENDPOINTS = [
  'drivers',
  'laps',
  'stints',
  'pit',
  'intervals',
  'position',        // race standings + GPS — used by frontend for driver map markers
  'weather',
  'race_control',
  'session_result',
  'starting_grid',
];

// Chunked endpoints: fetched per-driver in time windows to avoid timeouts/rate-limits.
// All driver chunks are merged into one {endpoint}.json per session.
// The frontend filters by driver_number client-side after fetching the single file.
const CHUNKED_ENDPOINTS = [
  // car_data: speed/throttle/brake/gear/rpm at ~3-4 Hz — ~400k records per race
  { name: 'car_data', chunkMs: 20 * 60_000, skip: SKIP_CARDATA },
  // location: GPS x/y/z at ~3-4 Hz — ~400k records per race
  { name: 'location', chunkMs: 20 * 60_000, skip: SKIP_LOC },
];

// ── Helpers ───────────────────────────────────────────────

const s3 = DRY_RUN ? null : new S3Client({ region: AWS_REGION });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJSON(url, retries = 6) {
  const headers = OPENF1_API_KEY ? { Authorization: `Bearer ${OPENF1_API_KEY}` } : {};
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 429) {
        // Exponential backoff: 5s, 10s, 20s, 40s, 80s
        const wait = 5000 * Math.pow(2, i);
        console.warn(`  429 rate-limit — waiting ${(wait/1000).toFixed(0)}s (attempt ${i+1}/${retries})`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      if (e.message?.includes('429')) continue; // already handled above
      await sleep(2000 * (i + 1));
    }
  }
}

async function existsInS3(key) {
  if (!s3) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToS3(key, data) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would upload s3://${S3_BUCKET}/${key} (${data.length} records)`);
    return;
  }
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=31536000, immutable', // historical data never changes
  }));
}

// Concurrency pool: run `tasks` (array of async functions) with max `concurrency` at once.
// Each worker inserts a small polite delay between requests to avoid burst rate-limiting.
async function pool(tasks, concurrency, delayMs = 600) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
      if (idx < tasks.length) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────

async function cacheSession(session, drivers) {
  const sk = session.session_key;

  // ── Simple endpoints (one request each) ──────────────────
  for (const endpoint of SIMPLE_ENDPOINTS) {
    const s3Key = `${sk}/${endpoint}.json`;
    if (await existsInS3(s3Key)) {
      console.log(`    ✓ ${endpoint}`);
      continue;
    }
    try {
      process.stdout.write(`    ↓ ${endpoint}… `);
      const data = await fetchJSON(`${BASE}/${endpoint}?session_key=${sk}`);
      await uploadToS3(s3Key, data);
      console.log(`${data.length} records`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
    await sleep(800);
  }

  // ── Chunked endpoints (per-driver + time-windowed) ────────
  for (const { name, chunkMs, skip } of CHUNKED_ENDPOINTS) {
    if (skip) {
      console.log(`    — ${name} (skipped)`);
      continue;
    }

    const s3Key = `${sk}/${name}.json`;
    if (await existsInS3(s3Key)) {
      console.log(`    ✓ ${name}`);
      continue;
    }

    try {
      process.stdout.write(`    ↓ ${name} (chunked × ${drivers.length} drivers)… `);

      const start = new Date(session.date_start);
      const end   = session.date_end
        ? new Date(session.date_end)
        : new Date(start.getTime() + 4 * 3_600_000); // 4h fallback

      const tasks = [];
      for (const drv of drivers) {
        for (let t = start.getTime(); t < end.getTime(); t += chunkMs) {
          const from = new Date(t).toISOString();
          const to   = new Date(Math.min(t + chunkMs, end.getTime())).toISOString();
          const url  = `${BASE}/${name}?session_key=${sk}&driver_number=${drv.driver_number}&date>=${from}&date<${to}`;
          tasks.push(() => fetchJSON(url));
        }
      }

      const chunks     = await pool(tasks, CONCURRENCY);
      const allRecords = chunks.flat().filter(Boolean);
      await uploadToS3(s3Key, allRecords);
      console.log(`${allRecords.length} records (${tasks.length} chunks)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }

    await sleep(1000);
  }
}

async function run() {
  console.log([
    `Years: ${YEARS.join(', ')}`,
    `Bucket: ${S3_BUCKET ?? '(dry-run)'}`,
    `Skip location: ${SKIP_LOC}`,
    `Skip car_data: ${SKIP_CARDATA}`,
    `Concurrency: ${CONCURRENCY}`,
  ].join('  |  '));

  for (const year of YEARS) {
    console.log(`\n── ${year} ────────────────────────`);
    const sessions = await fetchJSON(`${BASE}/sessions?year=${year}`);
    console.log(`  ${sessions.length} sessions`);

    // Skip practice sessions — they're large and less useful for replay
    const filtered = sessions.filter(s => !/practice/i.test(s.session_type ?? s.session_name ?? ''));
    console.log(`  ${filtered.length} sessions after skipping practice (${sessions.length - filtered.length} skipped)`);

    for (const session of filtered) {
      const sk = session.session_key;
      console.log(`\n  [${sk}] ${session.circuit_short_name} · ${session.session_name}`);

      // Fetch drivers once per session — shared by chunked endpoints
      let drivers;
      try {
        drivers = await fetchJSON(`${BASE}/drivers?session_key=${sk}`);
      } catch (e) {
        console.log(`  FAILED to fetch drivers: ${e.message} — skipping session`);
        continue;
      }

      await cacheSession(session, drivers);
    }
  }

  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
