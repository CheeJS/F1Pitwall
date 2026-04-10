// ── Replay shared types ──────────────────────────────────

export interface ReplayState {
  currentTime: number; // ms since epoch
  playing: boolean;
  speed: number;       // playback multiplier
}

export const SPEED_OPTIONS = [1, 4, 8, 16, 32] as const;

export interface TowerRow {
  driverNumber: number;
  abbreviation: string;
  teamColour: string;
  position: number;
  currentLap: number;
  lastLapTime: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  gap: number | string | null;
  interval: number | string | null;
  compound: string | null;
  tyreAge: number | null;
  inPits: boolean;
  isOut: boolean;
  bestLapTime: number | null;   // driver's personal best lap_duration in the session so far
  isFastestLap: boolean;        // holds the session overall fastest lap (purple)
  isPersonalBest: boolean;      // last completed lap equals their personal best (green)
  qualiOut: string | null;      // 'Q1' | 'Q2' — eliminated from this segment; null = still active
  pitStops: number;             // number of pit stops made so far
  // Qualifying segment times
  q1Time: number | null;        // best completed lap in Q1
  q2Time: number | null;        // best completed lap in Q2
  q3Time: number | null;        // best completed lap in Q3
  q1IsFastest: boolean;         // driver's Q1 time is the fastest Q1 time in the session
  q2IsFastest: boolean;         // driver's Q2 time is the fastest Q2 time in the session
  q3IsFastest: boolean;         // driver's Q3 time is the fastest Q3 time (= pole)
}

export const COMPOUND_STYLE: Record<string, { bg: string; fg: string; abbr: string }> = {
  SOFT:         { bg: '#e8002d', fg: '#fff', abbr: 'S' },
  MEDIUM:       { bg: '#ffd700', fg: '#000', abbr: 'M' },
  HARD:         { bg: '#d0d0d0', fg: '#000', abbr: 'H' },
  INTERMEDIATE: { bg: '#39b54a', fg: '#fff', abbr: 'I' },
  WET:          { bg: '#0067ff', fg: '#fff', abbr: 'W' },
};

// ── Pure helpers ─────────────────────────────────────────

export function parseDate(s: string): number {
  return new Date(s).getTime();
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtLap(secs: number | null): string {
  if (secs === null) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${s}` : `${secs.toFixed(3)}`;
}

export function bisectRight<T extends { t: number }>(arr: T[], t: number): T | null {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 ? arr[hi] : null;
}

export function gapSortKey(gap: number | string | null): number {
  if (gap === null) return 1e9;
  if (typeof gap === 'number') return gap;
  const m = /(\d+)\s+LAP/.exec(String(gap));
  return m ? 1e6 + parseInt(m[1]) * 1000 : 1e8;
}

export function fmtGap(gap: number | string | null, position: number): string {
  if (position === 1) return 'LEADER';
  if (gap === null) return '—';
  if (typeof gap === 'string') return gap;
  return `+${gap.toFixed(3)}`;
}

export function fmtInterval(interval: number | string | null): string {
  if (interval === null) return '—';
  if (typeof interval === 'string') return interval;
  return `+${interval.toFixed(3)}`;
}

export function isQualiSession(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'qualifying' || t === 'sprint qualifying' || t === 'sprint shootout';
}
