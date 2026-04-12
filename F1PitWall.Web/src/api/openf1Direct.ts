/**
 * Direct OpenF1 public API client.
 *
 * CDN cache: if VITE_OF1_CDN_BASE is set (e.g. https://d1234.cloudfront.net),
 * session-keyed endpoints try the CDN first:
 *   GET {CDN}/{session_key}/{endpoint}.json
 * and fall back to the live OpenF1 API on any failure.
 *
 * Session list / meeting endpoints always use the live API (they change during season).
 */

const BASE = 'https://api.openf1.org/v1';
const CDN  = (import.meta.env.VITE_OF1_CDN_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

// ── Cached fetch (CDN-first for session-keyed data) ───────

async function getCached<T>(
  sessionKey: number,
  endpoint: string,
  liveParams: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  // Try CDN first
  if (CDN) {
    try {
      const cdnUrl = `${CDN}/${sessionKey}/${endpoint}.json`;
      const r = await fetch(cdnUrl, { signal });
      if (r.ok) return r.json() as Promise<T>;
    } catch {
      // fall through to live API
    }
  }
  return get<T>(`/${endpoint}`, liveParams, signal);
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  // Retry with backoff on 429 (rate limit)
  const delays = [0, 2000, 5000, 10000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt]));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch(url.toString(), { signal });
    if (res.status === 429 && attempt < delays.length - 1) continue;
    // 404 = no data for this session (e.g. future race) — return empty
    if (res.status === 404) return [] as unknown as T;
    if (!res.ok) throw new Error(`OpenF1 ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
  }
  throw new Error('OpenF1: max retries exceeded');
}

// ── Param shapes ──────────────────────────────────────────

export interface SessionFilter { session_key?: number; meeting_key?: number; year?: number; session_type?: string; }
export interface DriverFilter  { session_key?: number; driver_number?: number; }
export interface LapFilter     { session_key?: number; driver_number?: number; lap_number?: number; }
export interface CarDataFilter { session_key?: number; driver_number?: number; }

// ── Response models ───────────────────────────────────────

export interface OF1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  gmt_offset: string;
  circuit_key: number;
  circuit_short_name: string;
  country_key: number;
  country_name: string;
  country_code: string;
  year: number;
  meeting_key: number;
}

export interface OF1Meeting {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name: string;
  location: string;
  country_key: number;
  country_name: string;
  country_code: string;
  circuit_key: number;
  circuit_short_name: string;
  date_start: string;
  gmt_offset: string;
  year: number;
  circuit_image?: string;
  country_flag?: string;
}

export interface OF1Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  first_name: string;
  last_name: string;
  headshot_url: string;
  country_code: string;
  session_key: number;
  meeting_key: number;
}

export interface OF1Lap {
  session_key: number;
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  i1_speed: number | null;
  i2_speed: number | null;
  st_speed: number | null;
  date_start: string;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  segments_sector_1: number[] | null;
  segments_sector_2: number[] | null;
  segments_sector_3: number[] | null;
  is_pit_out_lap: boolean;
}

export interface OF1CarData {
  session_key: number;
  driver_number: number;
  date: string;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  n_gear?: number;
}

// /position returns race standings only — no GPS coordinates.
// GPS data lives in /location (OF1Location), which is a separate endpoint.
export interface OF1Position {
  session_key: number;
  driver_number: number;
  date: string;
  position: number;
}

export interface OF1Interval {
  session_key: number;
  driver_number: number;
  date: string;
  gap_to_leader: number | string | null;
  interval: number | string | null;
}

export interface OF1Stint {
  session_key: number;
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end: number;
  compound: string;
  tyre_age_at_start: number;
}

export interface OF1TeamRadio {
  session_key: number;
  driver_number: number;
  date: string;
  recording_url: string;
}

export interface OF1Weather {
  session_key: number;
  date: string;
  air_temperature: number;
  humidity: number;
  pressure: number;
  rainfall: number;
  track_temperature: number;
  wind_direction: number;
  wind_speed: number;
}

export interface OF1RaceControl {
  session_key: number;
  date: string;
  driver_number: number | null;
  lap_number: number | null;
  message: string;
  category: string;
  scope: string;
  flag: string | null;
}

export interface OF1Pit {
  session_key: number;
  driver_number: number;
  lap_number: number;
  date: string;
  pit_duration: number | null;
}

export interface OF1Location {
  session_key: number;
  driver_number: number;
  date: string;
  x: number;
  y: number;
  z: number;
}

// Raw OpenF1 championship endpoints — no names/colours, just numbers.
// Join with /drivers to get broadcast_name, name_acronym, team_name, team_colour.
export interface OF1ChampionshipDriver {
  session_key: number;
  meeting_key: number;
  driver_number: number;
  position_current: number;
  position_start: number;
  points_current: number;
  points_start: number;
}

export interface OF1ChampionshipTeam {
  session_key: number;
  meeting_key: number;
  team_name: string;
  position_current: number;
  position_start: number;
  points_current: number;
  points_start: number;
}

export interface OF1SessionResult {
  session_key: number;
  driver_number: number;
  position: number;
  date: string;
}

export interface OF1StartingGrid {
  session_key: number;
  driver_number: number;
  grid_position: number;
}

export interface OF1Overtake {
  session_key: number;
  meeting_key: number;
  date: string;
  overtaking_driver_number: number;
  overtaken_driver_number: number;
  position: number;
}

// ── MultiViewer circuit layout ──────────────────────────
// Provides a clean pre-built circuit outline without needing driver GPS data.
// Same coordinate system as OpenF1 /location (F1 car axes, y increases upward).
interface CircuitPoint { number: number; letter?: string; trackPosition: { x: number; y: number } }
export interface OF1CircuitLayout {
  x: number[];
  y: number[];
  rotation: number;
  corners?: CircuitPoint[];
}

// ── API functions ─────────────────────────────────────────

export const OF1 = {
  sessions: (p?: SessionFilter, signal?: AbortSignal) =>
    get<OF1Session[]>('/sessions', p as Record<string,string|number|undefined>, signal),

  meetings: (p?: { year?: number; meeting_key?: number }, signal?: AbortSignal) =>
    get<OF1Meeting[]>('/meetings', p as Record<string,string|number|undefined>, signal),

  drivers: (p?: DriverFilter & { name_acronym?: string }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Driver[]>(p.session_key, 'drivers', p as Record<string,string|number|undefined>, signal)
      : get<OF1Driver[]>('/drivers', p as Record<string,string|number|undefined>, signal),

  laps: (p?: LapFilter, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Lap[]>(p.session_key, 'laps', p as Record<string,string|number|undefined>, signal)
      : get<OF1Lap[]>('/laps', p as Record<string,string|number|undefined>, signal),

  // car_data is special: the CDN stores one file with ALL drivers for the session.
  // We fetch it and filter client-side by driver_number so each driver's data is correct.
  carData: async (p?: CarDataFilter, signal?: AbortSignal): Promise<OF1CarData[]> => {
    if (p?.session_key && CDN) {
      try {
        const r = await fetch(`${CDN}/${p.session_key}/car_data.json`, { signal });
        if (r.ok) {
          const all = await r.json() as OF1CarData[];
          return p.driver_number !== undefined
            ? all.filter(d => d.driver_number === p.driver_number)
            : all;
        }
      } catch { /* fall through to live API */ }
    }
    return get<OF1CarData[]>('/car_data', p as Record<string,string|number|undefined>, signal);
  },

  intervals: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Interval[]>(p.session_key, 'intervals', p as Record<string,string|number|undefined>, signal)
      : get<OF1Interval[]>('/intervals', p as Record<string,string|number|undefined>, signal),

  stints: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Stint[]>(p.session_key, 'stints', p as Record<string,string|number|undefined>, signal)
      : get<OF1Stint[]>('/stints', p as Record<string,string|number|undefined>, signal),

  teamRadio: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    get<OF1TeamRadio[]>('/team_radio', p as Record<string,string|number|undefined>, signal),

  weather: (p?: { session_key?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Weather[]>(p.session_key, 'weather', p as Record<string,string|number|undefined>, signal)
      : get<OF1Weather[]>('/weather', p as Record<string,string|number|undefined>, signal),

  raceControl: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1RaceControl[]>(p.session_key, 'race_control', p as Record<string,string|number|undefined>, signal)
      : get<OF1RaceControl[]>('/race_control', p as Record<string,string|number|undefined>, signal),

  pits: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Pit[]>(p.session_key, 'pit', p as Record<string,string|number|undefined>, signal)
      : get<OF1Pit[]>('/pit', p as Record<string,string|number|undefined>, signal),

  location: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Location[]>(p.session_key, 'location', p as Record<string,string|number|undefined>, signal)
      : get<OF1Location[]>('/location', p as Record<string,string|number|undefined>, signal),

  position: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Position[]>(p.session_key, 'position', p as Record<string,string|number|undefined>, signal)
      : get<OF1Position[]>('/position', p as Record<string,string|number|undefined>, signal),

  driverChampionship: (p?: { session_key?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1ChampionshipDriver[]>(p.session_key, 'championship_drivers', p as Record<string,string|number|undefined>, signal)
      : get<OF1ChampionshipDriver[]>('/championship_drivers', p as Record<string,string|number|undefined>, signal),

  teamChampionship: (p?: { session_key?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1ChampionshipTeam[]>(p.session_key, 'championship_teams', p as Record<string,string|number|undefined>, signal)
      : get<OF1ChampionshipTeam[]>('/championship_teams', p as Record<string,string|number|undefined>, signal),

  sessionResults: (p?: { session_key?: number; driver_number?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1SessionResult[]>(p.session_key, 'session_result', p as Record<string,string|number|undefined>, signal)
      : get<OF1SessionResult[]>('/session_result', p as Record<string,string|number|undefined>, signal),

  startingGrid: (p?: { session_key?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1StartingGrid[]>(p.session_key, 'starting_grid', p as Record<string,string|number|undefined>, signal)
      : get<OF1StartingGrid[]>('/starting_grid', p as Record<string,string|number|undefined>, signal),

  overtakes: (p?: { session_key?: number }, signal?: AbortSignal) =>
    p?.session_key
      ? getCached<OF1Overtake[]>(p.session_key, 'overtakes', p as Record<string,string|number|undefined>, signal)
      : get<OF1Overtake[]>('/overtakes', p as Record<string,string|number|undefined>, signal),

  // MultiViewer API — clean circuit outline for the track map
  circuitLayout: (circuitKey: number, year: number, signal?: AbortSignal): Promise<OF1CircuitLayout | null> =>
    fetch(`https://api.multiviewer.app/api/v1/circuits/${circuitKey}/${year}`, { signal })
      .then(r => r.ok ? r.json() as Promise<OF1CircuitLayout> : null)
      .catch(() => null),
};
