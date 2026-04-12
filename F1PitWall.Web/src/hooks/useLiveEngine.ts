/**
 * useLiveEngine — live session data via OpenF1 MQTT.
 *
 * Production:  connects to wss://mqtt.openf1.org:8084/mqtt using a token
 *              fetched from the backend proxy at /api/openf1/token.
 *
 * Test mode:   set VITE_LIVE_TEST_SESSION_KEY=<session_key> in .env.local.
 *              Loads that historical session via REST and polls every 30s.
 *              No backend or paid account required — good for layout/logic testing.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { MqttClient } from 'mqtt';
import type {
  OF1Session, OF1Driver, OF1Lap, OF1Interval,
  OF1Position, OF1Stint, OF1Pit, OF1RaceControl, OF1Location, OF1CarData,
} from '../api/openf1Direct';
import type { TowerRow } from '../utils/replayUtils';
import { parseDate, isQualiSession, gapSortKey, bisectRight } from '../utils/replayUtils';

// ── Types ────────────────────────────────────────────────────────────────────

type LapEntry = {
  t: number; lapNumber: number; lapDuration: number | null;
  s1: number | null; s2: number | null; s3: number | null;
  seg1: number[] | null; seg2: number[] | null; seg3: number[] | null;
  stSpeed: number | null;
};

export type LiveStatus = 'idle' | 'loading' | 'polling' | 'connecting' | 'connected' | 'error';

// ── Config ───────────────────────────────────────────────────────────────────

const TEST_KEY   = import.meta.env.VITE_LIVE_TEST_SESSION_KEY
  ? Number(import.meta.env.VITE_LIVE_TEST_SESSION_KEY)
  : null;
const TEST_SPEED = import.meta.env.VITE_LIVE_TEST_SPEED
  ? Number(import.meta.env.VITE_LIVE_TEST_SPEED)
  : 1;

const MQTT_URL    = 'wss://mqtt.openf1.org:8084/mqtt';
const OF1_BASE    = 'https://api.openf1.org/v1';
const DATA_LAG_MS = 3_000;
const GRACE_MS    = 3 * 60_000;
const GAP_MS      = 5 * 60_000;

const MQTT_TOPICS = [
  'v1/laps', 'v1/intervals', 'v1/position', 'v1/stints',
  'v1/pit',  'v1/location',  'v1/race_control', 'v1/drivers',
  'v1/sessions', 'v1/car_data',
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function of1Fetch<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  token?: string | null,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${OF1_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const delays = [0, 2_000, 5_000, 10_000];
  for (let i = 0; i < delays.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delays[i]));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch(url.toString(), { signal, headers });
    if (res.status === 429 && i < delays.length - 1) continue;
    if (res.status === 404) return [] as unknown as T;
    if (!res.ok) throw new Error(`OpenF1 ${res.status}`);
    return res.json() as Promise<T>;
  }
  throw new Error('OpenF1: max retries exceeded');
}

async function bootstrapSession(sessionKey: number, token: string | null, signal: AbortSignal) {
  const p = { session_key: sessionKey };
  const [drivers, laps, intervals, positions, stints, pits, raceControl] = await Promise.all([
    of1Fetch<OF1Driver[]>    ('/drivers',      p, token, signal),
    of1Fetch<OF1Lap[]>       ('/laps',         p, token, signal),
    of1Fetch<OF1Interval[]>  ('/intervals',    p, token, signal),
    of1Fetch<OF1Position[]>  ('/position',     p, token, signal),
    of1Fetch<OF1Stint[]>     ('/stints',       p, token, signal),
    of1Fetch<OF1Pit[]>       ('/pit',          p, token, signal),
    of1Fetch<OF1RaceControl[]>('/race_control', p, token, signal),
  ]);
  return { drivers, laps, intervals, positions, stints, pits, raceControl };
}

/**
 * Binary search: returns the last element whose `date` <= t, or null.
 * Array must be sorted ascending by date.
 */
function latestBefore<T extends { date: string }>(arr: T[], t: number): T | null {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (parseDate(arr[mid].date) <= t) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best >= 0 ? arr[best] : null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveEngine(highlightedDriver?: number | null) {
  const [status, setStatus]   = useState<LiveStatus>('idle');
  const [session, setSession] = useState<OF1Session | null>(null);
  const [tick, setTick]       = useState(0);
  const [trackPoints, setTrackPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [circuitInfo, setCircuitInfo] = useState<import('../components/TrackMap').CircuitEnrichment | null>(null);

  // Keyed stores — updated by MQTT/bootstrap, never cause a render themselves
  const lapsByKey   = useRef(new Map<string, OF1Lap>());
  const stintsByKey = useRef(new Map<string, OF1Stint>());
  const pitsByKey   = useRef(new Map<string, OF1Pit>());

  // Time-sorted stores — full history per driver (binary-searched at render time)
  const intervalsByDriver = useRef(new Map<number, OF1Interval[]>());
  const positionsByDriver = useRef(new Map<number, OF1Position[]>());

  // Latest-value stores
  const locationByDriver = useRef(new Map<number, OF1Location>());
  const driverByNumber   = useRef(new Map<number, OF1Driver>());
  const raceControlMsgs  = useRef<OF1RaceControl[]>([]);

  // Car data per driver (sorted ascending by date, loaded lazily on selection)
  const carDataByDriver  = useRef(new Map<number, OF1CarData[]>());

  const mqttRef  = useRef<MqttClient | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Test-mode time simulation
  const testSessionStartMs = useRef<number | null>(null);
  const testLoadedAtMs     = useRef<number | null>(null);

  // ── Current simulated time (canonical for this render) ────────────────────

  const currentSimTime = useMemo((): number => {
    if (TEST_KEY && testSessionStartMs.current !== null && testLoadedAtMs.current !== null) {
      return testSessionStartMs.current + (Date.now() - testLoadedAtMs.current) * TEST_SPEED;
    }
    return Date.now() - DATA_LAG_MS;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // ── Populate stores from bootstrap arrays ──────────────────────────────────

  const populateStores = useCallback((data: {
    drivers: OF1Driver[]; laps: OF1Lap[]; intervals: OF1Interval[];
    positions: OF1Position[]; stints: OF1Stint[]; pits: OF1Pit[];
    raceControl: OF1RaceControl[];
  }) => {
    driverByNumber.current.clear();
    lapsByKey.current.clear();
    stintsByKey.current.clear();
    pitsByKey.current.clear();
    intervalsByDriver.current.clear();
    positionsByDriver.current.clear();
    raceControlMsgs.current = [];

    for (const d of data.drivers)
      driverByNumber.current.set(d.driver_number, d);

    for (const l of data.laps)
      lapsByKey.current.set(`lap_${l.driver_number}_${l.lap_number}`, l);

    for (const s of data.stints)
      stintsByKey.current.set(`stint_${s.driver_number}_${s.stint_number}`, s);

    for (const p of data.pits)
      pitsByKey.current.set(`pit_${p.driver_number}_${p.lap_number}`, p);

    // Group intervals by driver, sorted ascending by date
    for (const iv of data.intervals) {
      const arr = intervalsByDriver.current.get(iv.driver_number) ?? [];
      arr.push(iv);
      intervalsByDriver.current.set(iv.driver_number, arr);
    }
    for (const arr of intervalsByDriver.current.values())
      arr.sort((a, b) => parseDate(a.date) - parseDate(b.date));

    // Group positions by driver, sorted ascending by date
    for (const pos of data.positions) {
      const arr = positionsByDriver.current.get(pos.driver_number) ?? [];
      arr.push(pos);
      positionsByDriver.current.set(pos.driver_number, arr);
    }
    for (const arr of positionsByDriver.current.values())
      arr.sort((a, b) => parseDate(a.date) - parseDate(b.date));

    raceControlMsgs.current = [...data.raceControl]
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));

    // Test mode: anchor simulated time to earliest lap start
    if (TEST_KEY) {
      let earliest = Infinity;
      for (const l of data.laps) {
        if (l.date_start) {
          const t = new Date(l.date_start).getTime();
          if (t < earliest) earliest = t;
        }
      }
      testSessionStartMs.current = earliest === Infinity ? null : earliest;
      // Only anchor the wall-clock on the FIRST load.
      // Subsequent 30-second polls must NOT reset this — it would snap
      // currentSimTime back to t=0 and teleport all markers to the start line.
      if (testLoadedAtMs.current === null) {
        testLoadedAtMs.current = Date.now();
      }
    }
  }, []);

  // ── Process a single incoming MQTT message ─────────────────────────────────

  const processMessage = useCallback((topic: string, raw: Record<string, unknown>) => {
    const key = (raw._key as string | undefined) ?? '';

    switch (topic) {
      case 'v1/laps':
        lapsByKey.current.set(
          key || `lap_${raw.driver_number}_${raw.lap_number}`,
          raw as unknown as OF1Lap,
        );
        break;
      case 'v1/stints':
        stintsByKey.current.set(
          key || `stint_${raw.driver_number}_${raw.stint_number}`,
          raw as unknown as OF1Stint,
        );
        break;
      case 'v1/pit':
        pitsByKey.current.set(
          key || `pit_${raw.driver_number}_${raw.lap_number}`,
          raw as unknown as OF1Pit,
        );
        break;
      case 'v1/intervals': {
        const dn = raw.driver_number as number;
        if (dn) {
          // MQTT messages arrive chronologically — push is safe
          const arr = intervalsByDriver.current.get(dn) ?? [];
          arr.push(raw as unknown as OF1Interval);
          intervalsByDriver.current.set(dn, arr);
        }
        break;
      }
      case 'v1/position': {
        const dn = raw.driver_number as number;
        if (dn) {
          const arr = positionsByDriver.current.get(dn) ?? [];
          arr.push(raw as unknown as OF1Position);
          positionsByDriver.current.set(dn, arr);
        }
        break;
      }
      case 'v1/location': {
        const dn = raw.driver_number as number;
        if (dn) locationByDriver.current.set(dn, raw as unknown as OF1Location);
        break;
      }
      case 'v1/car_data': {
        const dn = raw.driver_number as number;
        if (dn) {
          const arr = carDataByDriver.current.get(dn) ?? [];
          arr.push(raw as unknown as OF1CarData);
          carDataByDriver.current.set(dn, arr);
        }
        break;
      }
      case 'v1/drivers': {
        const dn = raw.driver_number as number;
        if (dn) driverByNumber.current.set(dn, raw as unknown as OF1Driver);
        break;
      }
      case 'v1/race_control':
        raceControlMsgs.current.push(raw as unknown as OF1RaceControl);
        break;
      case 'v1/sessions':
        setSession(raw as unknown as OF1Session);
        break;
    }
  }, []);

  // ── Init: determine session → bootstrap → start MQTT or polling ────────────

  useEffect(() => {
    const ac = new AbortController();
    let mqttCleanup: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function init() {
      setStatus('loading');
      try {
        let sessionKey: number;
        let token: string | null = null;

        if (TEST_KEY) {
          sessionKey = TEST_KEY;
        } else {
          const tokenRes = await fetch('/api/openf1/token', { signal: ac.signal });
          if (!tokenRes.ok) throw new Error('Failed to fetch auth token from backend');
          token = (await tokenRes.json() as { token: string }).token;
          tokenRef.current = token;

          const sessions = await of1Fetch<OF1Session[]>(
            '/sessions', { session_key: 'latest' as unknown as number }, token, ac.signal,
          );
          if (!sessions.length) throw new Error('No live session found');
          sessionKey = sessions[0].session_key;
          setSession(sessions[0]);
        }

        if (TEST_KEY) {
          const sessions = await of1Fetch<OF1Session[]>(
            '/sessions', { session_key: sessionKey }, null, ac.signal,
          );
          if (sessions.length) setSession(sessions[0]);
        }

        const [data, sessions] = await Promise.all([
          bootstrapSession(sessionKey, token, ac.signal),
          of1Fetch<OF1Session[]>('/sessions', { session_key: sessionKey }, token, ac.signal),
        ]);
        if (ac.signal.aborted) return;
        populateStores(data);
        const sess = sessions[0] ?? null;
        if (sess) setSession(sess);

        // Fetch circuit outline from MultiViewer
        if (sess?.circuit_key && sess?.year) {
          fetch(`https://api.multiviewer.app/api/v1/circuits/${sess.circuit_key}/${sess.year}`, { signal: ac.signal })
            .then(r => r.ok ? r.json() : null)
            .then((layout: { x: number[]; y: number[]; corners?: { number: number; letter?: string; trackPosition: { x: number; y: number } }[] } | null) => {
              if (!layout || ac.signal.aborted) return;
              setTrackPoints(layout.x.map((x, i) => ({ x, y: layout.y[i] })));
              setCircuitInfo({ corners: (layout.corners ?? []).map(c => ({ number: c.number, letter: c.letter, x: c.trackPosition.x, y: c.trackPosition.y })) });
            })
            .catch(() => null);
        }

        setTick(t => t + 1);

        if (TEST_KEY) {
          setStatus('polling');
          pollTimer = setInterval(async () => {
            const fresh = await bootstrapSession(sessionKey, null, new AbortController().signal).catch(() => null);
            if (fresh) { populateStores(fresh); setTick(t => t + 1); }
          }, 30_000);
        } else {
          setStatus('connecting');
          const { default: mqtt } = await import('mqtt');

          const client = mqtt.connect(MQTT_URL, {
            username: 'pitwall',
            password: token!,
            clientId: `f1pitwall_${crypto.randomUUID()}`,
            clean: true,
            reconnectPeriod: 5_000,
          });

          mqttRef.current = client;

          client.on('connect', () => {
            setStatus('connected');
            client.subscribe(MQTT_TOPICS as unknown as string[], { qos: 0 });
          });

          client.on('message', (topic, payload) => {
            try { processMessage(topic, JSON.parse(payload.toString())); }
            catch { /* ignore malformed */ }
          });

          client.on('error', () => setStatus('error'));
          client.on('close', () => { if (!ac.signal.aborted) setStatus('connecting'); });

          mqttCleanup = () => { client.end(true); mqttRef.current = null; };
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          console.error('[useLiveEngine]', err);
          setStatus('error');
        }
      }
    }

    init();

    return () => {
      ac.abort();
      mqttCleanup?.();
      if (pollTimer !== null) clearInterval(pollTimer);
    };
  }, [populateStores, processMessage]);

  // ── Render tick: 4 Hz in test mode, 1 Hz live ─────────────────────────────

  useEffect(() => {
    const interval = TEST_KEY ? 250 : 1_000;
    const id = setInterval(() => setTick(t => t + 1), interval);
    return () => clearInterval(id);
  }, []);

  // ── Load car data for highlighted driver (lazy, one-time per driver) ───────

  useEffect(() => {
    if (!highlightedDriver || !session) return;
    if (carDataByDriver.current.has(highlightedDriver)) return;
    const ac = new AbortController();
    of1Fetch<OF1CarData[]>(
      '/car_data',
      { session_key: session.session_key, driver_number: highlightedDriver },
      tokenRef.current,
      ac.signal,
    )
      .then(data => {
        carDataByDriver.current.set(
          highlightedDriver,
          data.sort((a, b) => parseDate(a.date) - parseDate(b.date)),
        );
        setTick(t => t + 1);
      })
      .catch(() => null);
    return () => ac.abort();
  }, [highlightedDriver, session]);

  // ── Build tower rows ───────────────────────────────────────────────────────

  const towerRows = useMemo((): TowerRow[] => {
    const t = currentSimTime;
    const drivers = Array.from(driverByNumber.current.values());
    if (!drivers.length) return [];

    const sessionType = session?.session_type ?? '';
    const isQualifying = isQualiSession(sessionType);

    // ── lapIdx ──────────────────────────────────────────────────────────────
    const lapIdx = new Map<number, LapEntry[]>();
    for (const lap of lapsByKey.current.values()) {
      if (!lap.date_start) continue;
      const arr = lapIdx.get(lap.driver_number) ?? [];
      arr.push({
        t: parseDate(lap.date_start),
        lapNumber: lap.lap_number,
        lapDuration: lap.lap_duration,
        s1: lap.duration_sector_1 ?? null,
        s2: lap.duration_sector_2 ?? null,
        s3: lap.duration_sector_3 ?? null,
        seg1: lap.segments_sector_1,
        seg2: lap.segments_sector_2,
        seg3: lap.segments_sector_3,
        stSpeed: lap.st_speed,
      });
      lapIdx.set(lap.driver_number, arr);
    }
    for (const arr of lapIdx.values()) arr.sort((a, b) => a.t - b.t);

    // ── stintIdx ────────────────────────────────────────────────────────────
    const stintIdx = new Map<number, OF1Stint[]>();
    for (const s of stintsByKey.current.values()) {
      const arr = stintIdx.get(s.driver_number) ?? [];
      arr.push(s);
      stintIdx.set(s.driver_number, arr);
    }

    // ── Qualifying segment boundaries ───────────────────────────────────────
    let sqB1: number | null = null, sqB2: number | null = null;
    if (isQualifying) {
      const allStarts: number[] = [];
      for (const arr of lapIdx.values()) for (const l of arr) allStarts.push(l.t);
      allStarts.sort((a, b) => a - b);
      const bounds: number[] = [];
      for (let i = 1; i < allStarts.length; i++) {
        if (allStarts[i] - allStarts[i - 1] > GAP_MS) {
          bounds.push(allStarts[i]);
          if (bounds.length === 2) break;
        }
      }
      [sqB1, sqB2] = [bounds[0] ?? null, bounds[1] ?? null];
    }

    // ── Session bests ────────────────────────────────────────────────────────
    let sessionFastest = Infinity;
    let sessionQ1Best = Infinity, sessionQ2Best = Infinity, sessionQ3Best = Infinity;

    for (const arr of lapIdx.values()) {
      for (const l of arr) {
        if (l.t > t) break;
        if (!l.lapDuration || l.lapDuration <= 0 || l.t + l.lapDuration * 1_000 > t) continue;
        if (l.lapDuration < sessionFastest) sessionFastest = l.lapDuration;
        if (isQualifying) {
          if      (sqB1 === null || l.t < sqB1) { if (l.lapDuration < sessionQ1Best) sessionQ1Best = l.lapDuration; }
          else if (sqB2 === null || l.t < sqB2) { if (l.lapDuration < sessionQ2Best) sessionQ2Best = l.lapDuration; }
          else                                   { if (l.lapDuration < sessionQ3Best) sessionQ3Best = l.lapDuration; }
        }
      }
    }

    // ── Per-driver rows ──────────────────────────────────────────────────────
    const rows = drivers.map(drv => {
      const dn    = drv.driver_number;
      const dLaps = lapIdx.get(dn) ?? [];

      const dStints = (stintIdx.get(dn) ?? []).sort((a, b) => a.lap_start - b.lap_start);

      const lapEntry   = bisectRight(dLaps, t);
      const currentLap = lapEntry?.lapNumber ?? 0;

      let lastCompleted: LapEntry | null = null;
      for (const l of dLaps) {
        if (l.t > t) break;
        if (l.lapDuration !== null && l.lapDuration > 0 && l.t + l.lapDuration * 1_000 <= t)
          lastCompleted = l;
      }
      const lastLapTime = lastCompleted?.lapDuration ?? null;

      let bestLapTime: number | null = null, bestLapEntry: LapEntry | null = null;
      let q1Time: number | null = null, q2Time: number | null = null, q3Time: number | null = null;
      for (const l of dLaps) {
        if (l.t > t) break;
        if (!l.lapDuration || l.lapDuration <= 0 || l.t + l.lapDuration * 1_000 > t) continue;
        if (bestLapTime === null || l.lapDuration < bestLapTime) { bestLapTime = l.lapDuration; bestLapEntry = l; }
        if (isQualifying) {
          if      (sqB1 === null || l.t < sqB1) { if (q1Time === null || l.lapDuration < q1Time) q1Time = l.lapDuration; }
          else if (sqB2 === null || l.t < sqB2) { if (q2Time === null || l.lapDuration < q2Time) q2Time = l.lapDuration; }
          else                                   { if (q3Time === null || l.lapDuration < q3Time) q3Time = l.lapDuration; }
        }
      }

      // Gap / interval — latest at or before time t
      const ivArr    = intervalsByDriver.current.get(dn) ?? [];
      const latestIv = latestBefore(ivArr, t);
      const gap      = latestIv?.gap_to_leader ?? null;
      const interval = latestIv?.interval      ?? null;

      const currentStint =
        dStints.find(s => currentLap >= s.lap_start && currentLap <= (s.lap_end ?? Infinity))
        ?? (dStints.length ? dStints[dStints.length - 1] : null);

      // inPits: stint-transition detection
      // js-index-maps: build O(1) lap-by-number lookup instead of repeated O(n) .find()
      const lapByNumber = new Map(dLaps.map(l => [l.lapNumber, l]));
      let inPits = false;
      for (let si = 1; si < dStints.length; si++) {
        const inLapNum  = dStints[si - 1].lap_end;
        const outLapNum = dStints[si].lap_start;
        if (inLapNum == null || outLapNum == null) continue;
        const inLap  = lapByNumber.get(inLapNum);
        const outLap = lapByNumber.get(outLapNum);
        if (!inLap || !outLap || !inLap.lapDuration || inLap.lapDuration <= 0) continue;
        const pitStart = inLap.t + inLap.lapDuration * 1_000;
        if (t >= pitStart && t < outLap.t) { inPits = true; break; }
      }

      let qualiOut: string | null = null;
      if (isQualifying) {
        const hasAnyLap = dLaps.some(l => l.t <= t);
        if (hasAnyLap && sqB1 !== null && t > sqB1 + GRACE_MS) {
          if (!dLaps.some(l => l.t >= sqB1! && l.t <= t)) qualiOut = 'Q1';
        }
        if (qualiOut === null && sqB2 !== null && t > sqB2 + GRACE_MS) {
          if (!dLaps.some(l => l.t >= sqB2! && l.t <= t) && hasAnyLap) qualiOut = 'Q2';
        }
      }

      const sectorSource   = isQualifying ? bestLapEntry : lastCompleted;
      const isFastestLap   = bestLapTime !== null && bestLapTime === sessionFastest && sessionFastest !== Infinity;
      const isPersonalBest = lastLapTime !== null && lastLapTime === bestLapTime;

      return {
        driverNumber: dn,
        abbreviation: drv.name_acronym,
        teamColour:   drv.team_colour,
        position:     0,
        currentLap,
        lastLapTime,
        s1: sectorSource?.s1 ?? null,
        s2: sectorSource?.s2 ?? null,
        s3: sectorSource?.s3 ?? null,
        seg1: sectorSource?.seg1 ?? null,
        seg2: sectorSource?.seg2 ?? null,
        seg3: sectorSource?.seg3 ?? null,
        stSpeed: lastCompleted?.stSpeed ?? null,
        overtakeCount: 0, // live overtake data not fetched in real-time
        gap, interval,
        compound: currentStint?.compound ?? null,
        tyreAge:  currentStint ? currentLap - currentStint.lap_start + currentStint.tyre_age_at_start : null,
        inPits, isOut: false,
        bestLapTime, isFastestLap, isPersonalBest,
        qualiOut,
        pitStops: Math.max(0, dStints.length - 1),
        q1Time, q2Time, q3Time,
        q1IsFastest: q1Time !== null && q1Time === sessionQ1Best && sessionQ1Best !== Infinity,
        q2IsFastest: q2Time !== null && q2Time === sessionQ2Best && sessionQ2Best !== Infinity,
        q3IsFastest: q3Time !== null && q3Time === sessionQ3Best && sessionQ3Best !== Infinity,
      } satisfies TowerRow;
    });

    // ── Sort ─────────────────────────────────────────────────────────────────
    if (isQualifying) {
      const inQ3 = sqB2 !== null && t > sqB2;
      const inQ2 = !inQ3 && sqB1 !== null && t > sqB1;
      const segTime = (r: TowerRow): number | null => {
        if (!r.qualiOut) { if (inQ3) return r.q3Time; if (inQ2) return r.q2Time; return r.q1Time; }
        return r.qualiOut === 'Q2' ? (r.q2Time ?? r.q1Time) : r.q1Time;
      };
      const qualiGroup = (r: TowerRow): number => {
        if (!r.qualiOut) return segTime(r) !== null ? 0 : 1;
        if (r.qualiOut === 'Q2') return segTime(r) !== null ? 2 : 3;
        return segTime(r) !== null ? 4 : 5;
      };
      rows.sort((a, b) => {
        const ga = qualiGroup(a), gb = qualiGroup(b);
        if (ga !== gb) return ga - gb;
        const ta = segTime(a), tb = segTime(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1; if (tb === null) return -1;
        return ta - tb;
      });
      const poleTime = segTime(rows[0]);
      rows.forEach((r, i) => {
        const rt = segTime(r);
        r.gap      = i === 0 || poleTime === null || rt === null ? null : rt - poleTime;
        const prev = i > 0 ? segTime(rows[i - 1]) : null;
        r.interval = prev !== null && rt !== null ? rt - prev : null;
      });
    } else {
      rows.sort((a, b) => {
        const posArrA = positionsByDriver.current.get(a.driverNumber) ?? [];
        const posArrB = positionsByDriver.current.get(b.driverNumber) ?? [];
        const pa = latestBefore(posArrA, t)?.position ?? 99;
        const pb = latestBefore(posArrB, t)?.position ?? 99;
        if (pa !== pb) return pa - pb;
        return gapSortKey(a.gap) - gapSortKey(b.gap);
      });
    }

    rows.forEach((r, i) => { r.position = i + 1; });
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSimTime, session]);

  // ── Safety car (filtered by current simulated time) ────────────────────────

  const safetyCarStatus = useMemo((): string | null => {
    const t = currentSimTime;
    const scMsgs = raceControlMsgs.current.filter(
      m => m.category === 'SafetyCar' && parseDate(m.date) <= t,
    );
    if (!scMsgs.length) return null;
    const msg = scMsgs[scMsgs.length - 1].message?.toUpperCase() ?? '';
    if (msg.includes('VIRTUAL') || msg.includes('VSC')) return 'VSC';
    if (msg.includes('DEPLOYED') || msg.includes('SAFETY CAR')) return 'SC';
    if (msg.includes('RESUMED') || msg.includes('WITHDRAWN')) return 'None';
    return null;
  }, [currentSimTime]);

  // ── Driver markers for track map ───────────────────────────────────────────

  const driverMarkers = useMemo((): import('../components/TrackMap').DriverMarker[] => {
    if (!towerRows.length) return [];

    // Live MQTT: use GPS location data
    if (!TEST_KEY && locationByDriver.current.size > 0 && trackPoints && trackPoints.length > 10) {
      return towerRows.flatMap(row => {
        const loc = locationByDriver.current.get(row.driverNumber);
        if (!loc) return [];
        return [{ driverNumber: row.driverNumber, abbreviation: row.abbreviation, teamColour: row.teamColour, x: loc.x, y: loc.y, position: row.position }];
      });
    }

    // Test mode: interpolate along trackPoints from lap progress
    if (!trackPoints || trackPoints.length <= 10) return [];

    const t = currentSimTime;

    return towerRows.flatMap(row => {
      const dLaps: LapEntry[] = [];
      for (const lap of lapsByKey.current.values()) {
        if (lap.driver_number === row.driverNumber && lap.date_start)
          dLaps.push({ t: parseDate(lap.date_start), lapNumber: lap.lap_number, lapDuration: lap.lap_duration, s1: lap.duration_sector_1 ?? null, s2: lap.duration_sector_2 ?? null, s3: lap.duration_sector_3 ?? null, seg1: lap.segments_sector_1, seg2: lap.segments_sector_2, seg3: lap.segments_sector_3, stSpeed: lap.st_speed });
      }
      dLaps.sort((a, b) => a.t - b.t);

      // Find the lap the driver is currently ON:
      // bisectRight gives the latest lap whose date_start <= t,
      // but we also check that t hasn't run past that lap's end.
      // If it has (gap between in-lap end and out-lap start, i.e. pit stop),
      // walk forward to the first lap where the driver is actually inside it.
      let lapEntry = bisectRight(dLaps, t);
      if (!lapEntry) return [];

      // Walk forward if t is past the end of this lap and the next lap exists
      for (let i = dLaps.indexOf(lapEntry); i < dLaps.length - 1; i++) {
        const cur     = dLaps[i];
        const durMs   = (cur.lapDuration ?? 0) * 1_000;
        if (durMs > 0 && t > cur.t + durMs) {
          // t is past the end of this lap — step to the next if it hasn't started
          const next = dLaps[i + 1];
          if (next.t > t) break;  // next lap started after t, stay on current
          lapEntry = next;
        } else {
          break;
        }
      }

      const elapsed  = t - lapEntry.t;
      const durMs    = (lapEntry.lapDuration ?? 90) * 1_000;
      const frac     = Math.max(0, Math.min(1, elapsed / durMs));
      const exactIdx = frac * (trackPoints.length - 1);
      const lo       = trackPoints[Math.floor(exactIdx)];
      const hi       = trackPoints[Math.min(Math.ceil(exactIdx), trackPoints.length - 1)];
      const f        = exactIdx - Math.floor(exactIdx);
      return [{
        driverNumber: row.driverNumber,
        abbreviation: row.abbreviation,
        teamColour:   row.teamColour,
        x: lo.x + (hi.x - lo.x) * f,
        y: lo.y + (hi.y - lo.y) * f,
        position: row.position,
      }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSimTime, towerRows, trackPoints]);

  // ── Derived data for telemetry panel ──────────────────────────────────────

  const drivers = useMemo(
    () => Array.from(driverByNumber.current.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  const stintIdx = useMemo(() => {
    const map = new Map<number, OF1Stint[]>();
    for (const s of stintsByKey.current.values()) {
      const arr = map.get(s.driver_number) ?? [];
      arr.push(s);
      map.set(s.driver_number, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.lap_start - b.lap_start);
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const allLaps = useMemo(
    () => Array.from(lapsByKey.current.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  return {
    towerRows,
    isQualifying: isQualiSession(session?.session_type ?? ''),
    selectedSession: session,
    driverMarkers,
    safetyCarStatus,
    raceControlMessages: raceControlMsgs.current,
    status,
    trackPoints,
    circuitInfo,
    currentSimTime,
    sessionStart: testSessionStartMs.current,
    drivers,
    stintIdx,
    allLaps,
    carDataMap: carDataByDriver.current,
  };
}
