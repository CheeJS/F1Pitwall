/**
 * cache-openf1.mjs
 *
 * Downloads all historical OpenF1 session data and uploads it to S3.
 * Each session gets a folder:  s3://{BUCKET}/{session_key}/{endpoint}.json
 *
 * Usage:
 *   node scripts/cache-openf1.mjs [--years 2023,2024,2025] [--dry-run]
 *
 * Env vars required:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION           (e.g. eu-west-1)
 *   S3_BUCKET            (e.g. f1pitwall-cache)
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
const DRY_RUN = process.argv.includes('--dry-run');

const BASE = 'https://api.openf1.org/v1';
const S3_BUCKET = process.env.S3_BUCKET ?? process.env.S3_PREDICTIONS_BUCKET;
const AWS_REGION = process.env.AWS_REGION ?? 'ap-southeast-2';
const OPENF1_API_KEY = process.env.OPENF1_API_KEY ?? '';

// Endpoints to cache for every session (no per-driver splitting — full session)
const SESSION_ENDPOINTS = [
  'drivers',
  'laps',
  'stints',
  'pit',
  'intervals',
  'weather',
  'race_control',
  'session_result',
  'starting_grid',
  'location',   // largest — ~50MB per session, skip with --skip-location
];

if (!S3_BUCKET && !DRY_RUN) {
  console.error('S3_BUCKET env var required');
  process.exit(1);
}

const skipLocation = process.argv.includes('--skip-location');
const endpoints = skipLocation ? SESSION_ENDPOINTS.filter(e => e !== 'location') : SESSION_ENDPOINTS;

const s3 = DRY_RUN ? null : new S3Client({ region: AWS_REGION });

// ── Helpers ───────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJSON(url, retries = 3) {
  const headers = OPENF1_API_KEY ? { Authorization: `Bearer ${OPENF1_API_KEY}` } : {};
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 429) {
        const wait = 2000 * (i + 1);
        console.warn(`  429 rate-limit on ${url} — waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000);
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
    console.log(`  [dry-run] would upload s3://${S3_BUCKET}/${key}`);
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

// ── Concurrency pool ─────────────────────────────────────
async function pool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────

async function run() {
  console.log(`Years: ${YEARS.join(', ')}  |  Bucket: ${S3_BUCKET ?? '(dry-run)'}  |  Skip location: ${skipLocation}`);

  for (const year of YEARS) {
    console.log(`\n── ${year} ────────────────────────`);
    const sessions = await fetchJSON(`${BASE}/sessions?year=${year}`);
    console.log(`  ${sessions.length} sessions`);

    for (const session of sessions) {
      const sk = session.session_key;
      console.log(`\n  [${sk}] ${session.circuit_short_name} · ${session.session_name}`);

      for (const endpoint of endpoints) {
        const s3Key = `${sk}/${endpoint}.json`;

        // Skip if already cached
        if (await existsInS3(s3Key)) {
          console.log(`    ✓ ${endpoint} (already cached)`);
          continue;
        }

        try {
          // Location: one request per driver per 20-min window, fetched in parallel
          if (endpoint === 'location') {
            process.stdout.write(`    ↓ ${endpoint} (parallel)… `);
            const drivers = await fetchJSON(`${BASE}/drivers?session_key=${sk}`);
            const start = new Date(session.date_start);
            const end = session.date_end ? new Date(session.date_end) : new Date(start.getTime() + 4 * 3600_000);
            const CHUNK_MS = 20 * 60_000; // 20-min window per driver ≈ 4 400 rows max
            const tasks = [];
            for (const drv of drivers) {
              for (let t = start.getTime(); t < end.getTime(); t += CHUNK_MS) {
                const from = new Date(t).toISOString();
                const to = new Date(Math.min(t + CHUNK_MS, end.getTime())).toISOString();
                const url = `${BASE}/location?session_key=${sk}&driver_number=${drv.driver_number}&date>=${from}&date<${to}`;
                tasks.push(() => fetchJSON(url));
              }
            }
            const chunks = await pool(tasks, 8);
            const allRecords = chunks.flat().filter(Boolean);
            await uploadToS3(s3Key, allRecords);
            console.log(`${allRecords.length} records (${drivers.length} drivers, ${tasks.length} chunks)`);
          } else {
            const url = `${BASE}/${endpoint}?session_key=${sk}`;
            process.stdout.write(`    ↓ ${endpoint}… `);
            const data = await fetchJSON(url);
            await uploadToS3(s3Key, data);
            console.log(`${data.length} records uploaded`);
          }
        } catch (e) {
          console.log(`FAILED: ${e.message}`);
        }

        // Polite delay between requests to avoid rate-limiting
        await sleep(300);
      }
    }
  }

  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
