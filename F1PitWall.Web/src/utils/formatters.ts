// ── Tyre compound display metadata ────────────────────────
export interface TyreStyle {
  label: string;
  bg: string;
  color: string;
}

const TYRE_MAP: Record<string, TyreStyle> = {
  SOFT:         { label: 'S', bg: '#dc2626', color: '#fff' },
  MEDIUM:       { label: 'M', bg: '#ca8a04', color: '#fff' },
  HARD:         { label: 'H', bg: '#e4e4e7', color: '#18181b' },
  INTERMEDIATE: { label: 'I', bg: '#16a34a', color: '#fff' },
  WET:          { label: 'W', bg: '#2563eb', color: '#fff' },
};

export function getTyreStyle(compound: string | null): TyreStyle {
  if (!compound) return { label: '?', bg: '#3f3f46', color: '#a1a1aa' };
  return TYRE_MAP[compound.toUpperCase()] ?? { label: compound[0] ?? '?', bg: '#3f3f46', color: '#a1a1aa' };
}

// ── Team colour helper ────────────────────────────────────
// OpenF1 sends hex without the '#' prefix (e.g. "00D2BE")
export function teamColor(hex: string | null | undefined): string {
  if (!hex) return '#3f3f46';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

// ── Gap / interval display ────────────────────────────────
// OpenF1 leader gap is "0.000" or empty; normalise to "— LEADER —"
export function formatGap(gap: string | null, isLeader: boolean): string {
  if (isLeader || gap === null || gap === '0.000' || gap === '') return '';
  return gap.startsWith('+') ? gap : `+${gap}`;
}

// ── Relative timestamp ────────────────────────────────────
export function timeAgo(ts: number | null): string {
  if (ts === null) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

// ── Find the fastest (minimum) lap time across all drivers ─
// Returns the raw lap time string of the session leader's best lap.
export function findFastestLap(
  drivers: Record<string, { lastLapTime: string | null }>,
): string | null {
  let fastest: string | null = null;

  for (const d of Object.values(drivers)) {
    if (!d.lastLapTime) continue;
    if (!fastest || compareLapTimes(d.lastLapTime, fastest) < 0) {
      fastest = d.lastLapTime;
    }
  }
  return fastest;
}

// Naive lap time comparison — works for MM:SS.mmm format and SS.mmm format.
function compareLapTimes(a: string, b: string): number {
  return parseLapTimeMs(a) - parseLapTimeMs(b);
}

function parseLapTimeMs(t: string): number {
  // Handles "1:20.456" and "80.456"
  const parts = t.split(':');
  if (parts.length === 2) {
    return Number(parts[0]) * 60_000 + Number(parts[1]) * 1_000;
  }
  return Number(t) * 1_000;
}
