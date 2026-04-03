import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  OF1,
  type OF1Session, type OF1Driver, type OF1Lap, type OF1CarData,
  type OF1RaceControl, type OF1Stint, type OF1Pit, type OF1Interval,
  type OF1Position, type OF1Weather,
} from '../api/openf1Direct';
import type { DriverMarker } from '../components/TrackMap';
import {
  type ReplayState, type TowerRow,
  parseDate, bisectRight, gapSortKey,
} from '../utils/replayUtils';

// ── Hook input / output ──────────────────────────────────

// Minimal session info needed to bootstrap replay — avoids re-fetching from OpenF1
export interface ReplaySessionInfo {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  circuit_key?: number;
  circuit_short_name: string;
  country_name: string;
  year: number;
}

interface UseReplayEngineOpts {
  /** Full session info if available (from backend API) — avoids an OpenF1 fetch */
  session?: ReplaySessionInfo | null;
  /** Fallback: just the key (pop-out window). Will fetch session metadata from OpenF1. */
  sessionKey?: number;
  highlightedDriver: number | null;
  /** Additional drivers to load car data for (comparison) */
  comparedDrivers?: number[];
}

export interface ReplayEngine {
  // Session
  selectedSession: OF1Session | null;

  // Data
  drivers: OF1Driver[];
  laps: OF1Lap[];
  carDataMap: Map<number, OF1CarData[]>;
  raceControl: OF1RaceControl[];
  stints: OF1Stint[];
  pits: OF1Pit[];
  intervals: OF1Interval[];

  // Loading
  loading: boolean;
  loadingCarData: boolean;
  error: string | null;

  // Replay state
  rs: ReplayState;
  minTime: number;
  maxTime: number;

  // Indices
  stintIdx: Map<number, OF1Stint[]>;

  // Computed
  towerRows: TowerRow[];
  totalLaps: number;
  highlightedCarData: OF1CarData | null;

  // Track map
  driverMarkers: DriverMarker[];
  trackPoints: { x: number; y: number }[] | null;

  // Weather
  currentWeather: OF1Weather | null;

  // Actions
  play: () => void;
  pause: () => void;
  scrub: (t: number) => void;
  setSpeed: (s: number) => void;
}

// ── Hook ─────────────────────────────────────────────────

export function useReplayEngine({ session, sessionKey, highlightedDriver, comparedDrivers = [] }: UseReplayEngineOpts): ReplayEngine {
  const [selectedSession, setSelectedSession] = useState<OF1Session | null>(null);
  const resolvedKey = session?.session_key ?? sessionKey;

  const [drivers, setDrivers] = useState<OF1Driver[]>([]);
  const [laps, setLaps] = useState<OF1Lap[]>([]);
  const [carDataMap, setCarDataMap] = useState<Map<number, OF1CarData[]>>(new Map());
  const [loadingCarData, setLoadingCarData] = useState(false);
  const [raceControl, setRaceControl] = useState<OF1RaceControl[]>([]);
  const [stints, setStints] = useState<OF1Stint[]>([]);
  const [pits, setPits] = useState<OF1Pit[]>([]);
  const [intervals, setIntervals] = useState<OF1Interval[]>([]);
  const [positions, setPositions] = useState<OF1Position[]>([]);
  const [weather, setWeather] = useState<OF1Weather[]>([]);
  const [trackPoints, setTrackPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replay state
  const [rs, setRs] = useState<ReplayState>({ currentTime: 0, playing: false, speed: 4 });
  const rafRef = useRef<number | null>(null);
  const lastRealTime = useRef<number>(0);

  // ── Derived timeline ───────────────────────────────────
  const { minTime, maxTime } = useMemo(() => {
    const starts = laps.filter(l => l.date_start).map(l => parseDate(l.date_start));
    const ends = laps.filter(l => l.date_start && l.lap_duration)
      .map(l => parseDate(l.date_start) + (l.lap_duration ?? 0) * 1000);
    const all = [...starts, ...ends];
    if (!all.length) return { minTime: 0, maxTime: 0 };
    return { minTime: Math.min(...all), maxTime: Math.max(...all) };
  }, [laps]);

  // ── Resolve session metadata ────────────────────────────
  // If `session` prop is provided, use it directly (no fetch needed).
  // Otherwise fall back to fetching by sessionKey (pop-out window case).
  useEffect(() => {
    if (session) {
      // Build an OF1Session-shaped object from the provided info
      setSelectedSession(prev => {
        if (prev?.session_key === session.session_key) return prev;
        return {
          session_key: session.session_key,
          session_name: session.session_name,
          session_type: session.session_type,
          date_start: session.date_start,
          date_end: '',
          gmt_offset: '',
          circuit_key: session.circuit_key ?? 0,
          circuit_short_name: session.circuit_short_name,
          country_key: 0,
          country_name: session.country_name,
          country_code: '',
          year: session.year,
          meeting_key: 0,
        } satisfies OF1Session;
      });
      return;
    }
    if (!resolvedKey) {
      setSelectedSession(null);
      return;
    }
    if (selectedSession?.session_key === resolvedKey) return;

    const ac = new AbortController();
    OF1.sessions({ session_key: resolvedKey }, ac.signal)
      .then(sessions => {
        if (sessions.length > 0 && !ac.signal.aborted) {
          setSelectedSession(sessions[0]);
        }
      })
      .catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_key, resolvedKey]);

  // ── Load session data ──────────────────────────────────
  useEffect(() => {
    if (!selectedSession) return;
    const sk = selectedSession.session_key;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setDrivers([]);
    setLaps([]);
    setCarDataMap(new Map());
    setRaceControl([]);
    setStints([]);
    setPits([]);
    setIntervals([]);
    setPositions([]);
    setWeather([]);
    setTrackPoints(null);
    setRs({ currentTime: parseDate(selectedSession.date_start), playing: false, speed: 4 });

    // Load data in small batches to avoid OpenF1 rate limits (429).
    // Each batch waits for the previous one to finish before starting.
    const load = async () => {
      try {
        // Batch 1: core data (drivers, laps, stints)
        const [drvs, lapData, stintsRes] = await Promise.allSettled([
          OF1.drivers({ session_key: sk }, ac.signal),
          OF1.laps({ session_key: sk }, ac.signal),
          OF1.stints({ session_key: sk }, ac.signal),
        ]);
        if (ac.signal.aborted) return;
        if (drvs.status === 'fulfilled') setDrivers(drvs.value);
        if (lapData.status === 'fulfilled') {
          setLaps(lapData.value);
          const starts = lapData.value.filter(l => l.date_start).map(l => parseDate(l.date_start));
          if (starts.length) {
            setRs(prev => ({ ...prev, currentTime: Math.min(...starts) }));
          }
        }
        if (stintsRes.status === 'fulfilled') setStints(stintsRes.value);

        // Batch 2: timing & events
        const [rc, pitsRes, intervalsRes] = await Promise.allSettled([
          OF1.raceControl({ session_key: sk }, ac.signal),
          OF1.pits({ session_key: sk }, ac.signal),
          OF1.intervals({ session_key: sk }, ac.signal),
        ]);
        if (ac.signal.aborted) return;
        if (rc.status === 'fulfilled') setRaceControl(rc.value);
        if (pitsRes.status === 'fulfilled') setPits(pitsRes.value);
        if (intervalsRes.status === 'fulfilled') setIntervals(intervalsRes.value);

        // Batch 3: position & weather (lower priority, larger data)
        const [posRes, weatherRes] = await Promise.allSettled([
          OF1.position({ session_key: sk }, ac.signal),
          OF1.weather({ session_key: sk }, ac.signal),
        ]);
        if (ac.signal.aborted) return;
        if (posRes.status === 'fulfilled') setPositions(posRes.value);
        if (weatherRes.status === 'fulfilled') setWeather(weatherRes.value);
      } catch {
        // AbortError or network failure — handled by .finally
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    };
    load();

    return () => ac.abort();
  }, [selectedSession]);

  // ── Load circuit layout ────────────────────────────────
  useEffect(() => {
    if (!selectedSession || !selectedSession.circuit_key) return;
    const ac = new AbortController();
    OF1.circuitLayout(selectedSession.circuit_key, selectedSession.year, ac.signal)
      .then(layout => {
        if (layout && !ac.signal.aborted) {
          setTrackPoints(layout.x.map((x, i) => ({ x, y: layout.y[i] })));
        }
      });
    return () => ac.abort();
  }, [selectedSession]);

  // ── On-demand car data loading ─────────────────────────
  const loadedDriversRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    loadedDriversRef.current = new Set();
  }, [selectedSession]);

  useEffect(() => {
    if (!selectedSession || loading) return;
    const sk = selectedSession.session_key;
    // Load car data for highlighted driver + compared drivers
    const wanted = new Set<number>();
    if (highlightedDriver !== null) wanted.add(highlightedDriver);
    for (const dn of comparedDrivers) wanted.add(dn);
    // If nothing selected, load first 3 drivers
    if (wanted.size === 0) {
      for (const d of drivers.slice(0, 3)) wanted.add(d.driver_number);
    }
    const driversToLoad = Array.from(wanted);

    const pending = driversToLoad.filter(dn => !loadedDriversRef.current.has(dn));
    if (!pending.length) return;

    setLoadingCarData(true);
    const ac = new AbortController();

    (async () => {
      for (const dn of pending) {
        if (ac.signal.aborted) break;
        try {
          const data = await OF1.carData({ session_key: sk, driver_number: dn }, ac.signal);
          if (!ac.signal.aborted) {
            loadedDriversRef.current.add(dn);
            setCarDataMap(prev => {
              const next = new Map(prev);
              const sorted = [...data].sort((a, b) => parseDate(a.date) - parseDate(b.date));
              next.set(dn, sorted);
              return next;
            });
          }
        } catch {
          // skip on error
        }
        await new Promise(r => setTimeout(r, 200));
      }
      if (!ac.signal.aborted) setLoadingCarData(false);
    })();

    return () => { ac.abort(); setLoadingCarData(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedDriver, comparedDrivers.join(','), drivers.length, loading, selectedSession]);

  // ── Playback loop ──────────────────────────────────────
  const tick = useCallback(() => {
    const now = performance.now();
    const dt = now - lastRealTime.current;
    lastRealTime.current = now;
    setRs(prev => {
      if (!prev.playing) return prev;
      const next = prev.currentTime + dt * prev.speed;
      if (next >= maxTime) return { ...prev, playing: false, currentTime: maxTime };
      return { ...prev, currentTime: next };
    });
    rafRef.current = requestAnimationFrame(tick);
  }, [maxTime]);

  useEffect(() => {
    if (rs.playing) {
      lastRealTime.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [rs.playing, tick]);

  // ── Indices ────────────────────────────────────────────

  const lapIdx = useMemo(() => {
    const m = new Map<number, Array<{ t: number; lapNumber: number; lapDuration: number | null; s1: number | null; s2: number | null; s3: number | null }>>();
    for (const l of laps) {
      if (!l.date_start) continue;
      const arr = m.get(l.driver_number) ?? [];
      arr.push({ t: parseDate(l.date_start), lapNumber: l.lap_number, lapDuration: l.lap_duration, s1: l.duration_sector_1, s2: l.duration_sector_2, s3: l.duration_sector_3 });
      m.set(l.driver_number, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    return m;
  }, [laps]);

  const intervalIdx = useMemo(() => {
    const m = new Map<number, Array<{ t: number; gap: number | string | null; interval: number | string | null }>>();
    for (const iv of intervals) {
      const arr = m.get(iv.driver_number) ?? [];
      arr.push({ t: parseDate(iv.date), gap: iv.gap_to_leader, interval: iv.interval });
      m.set(iv.driver_number, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    return m;
  }, [intervals]);

  const stintIdx = useMemo(() => {
    const m = new Map<number, OF1Stint[]>();
    for (const s of stints) {
      const arr = m.get(s.driver_number) ?? [];
      arr.push(s);
      m.set(s.driver_number, arr);
    }
    return m;
  }, [stints]);

  const pitIdx = useMemo(() => {
    const m = new Map<number, Array<{ t: number; duration: number }>>();
    for (const p of pits) {
      const arr = m.get(p.driver_number) ?? [];
      arr.push({ t: parseDate(p.date), duration: (p.pit_duration ?? 30) * 1000 });
      m.set(p.driver_number, arr);
    }
    return m;
  }, [pits]);

  const positionIdx = useMemo(() => {
    const m = new Map<number, Array<{ t: number; x: number; y: number; position: number }>>();
    for (const p of positions) {
      const arr = m.get(p.driver_number) ?? [];
      arr.push({ t: parseDate(p.date), x: p.x, y: p.y, position: p.position });
      m.set(p.driver_number, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    return m;
  }, [positions]);

  const weatherIdx = useMemo(() => {
    return weather.map(w => ({ t: parseDate(w.date), ...w })).sort((a, b) => a.t - b.t);
  }, [weather]);

  // ── Computed values ────────────────────────────────────

  const towerRows = useMemo((): TowerRow[] => {
    const t = rs.currentTime;
    if (!drivers.length || t <= 0) return [];

    const rows = drivers.map(drv => {
      const dn = drv.driver_number;
      const lapEntry = bisectRight(lapIdx.get(dn) ?? [], t);
      const currentLap = lapEntry?.lapNumber ?? 0;
      const lastLapTime = lapEntry?.lapDuration ?? null;
      const s1 = lapEntry?.s1 ?? null;
      const s2 = lapEntry?.s2 ?? null;
      const s3 = lapEntry?.s3 ?? null;

      const iv = bisectRight(intervalIdx.get(dn) ?? [], t);

      const dStints = stintIdx.get(dn) ?? [];
      const currentStint =
        dStints.find(s => currentLap >= s.lap_start && currentLap <= (s.lap_end ?? Infinity)) ??
        (dStints.length ? dStints[dStints.length - 1] : null);

      const dPits = pitIdx.get(dn) ?? [];
      const inPits = dPits.some(p => t >= p.t && t < p.t + p.duration);

      return {
        driverNumber: dn,
        abbreviation: drv.name_acronym,
        teamColour: drv.team_colour,
        position: 0,
        currentLap,
        lastLapTime,
        s1, s2, s3,
        gap: iv?.gap ?? null,
        interval: iv?.interval ?? null,
        compound: currentStint?.compound ?? null,
        tyreAge: currentStint ? currentLap - currentStint.lap_start + currentStint.tyre_age_at_start : null,
        inPits,
      } satisfies TowerRow;
    });

    rows.sort((a, b) => {
      const da = gapSortKey(a.gap), db = gapSortKey(b.gap);
      if (da !== db) return da - db;
      return b.currentLap - a.currentLap;
    });
    rows.forEach((r, i) => { r.position = i + 1; });
    return rows;
  }, [rs.currentTime, drivers, lapIdx, intervalIdx, stintIdx, pitIdx]);

  const totalLaps = useMemo(() =>
    laps.length ? Math.max(...laps.map(l => l.lap_number)) : 0,
  [laps]);

  const highlightedCarData = useMemo((): OF1CarData | null => {
    if (highlightedDriver === null) return null;
    const dData = carDataMap.get(highlightedDriver) ?? [];
    const t = rs.currentTime;
    let lo = 0, hi = dData.length - 1, result: OF1CarData | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (parseDate(dData[mid].date) <= t) { result = dData[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  }, [highlightedDriver, carDataMap, rs.currentTime]);

  // Driver markers for track map
  const driverMarkers = useMemo((): DriverMarker[] => {
    const t = rs.currentTime;
    if (!drivers.length || t <= 0) return [];
    const result: DriverMarker[] = [];
    for (const drv of drivers) {
      const entry = bisectRight(positionIdx.get(drv.driver_number) ?? [], t);
      if (!entry) continue;
      result.push({
        driverNumber: drv.driver_number,
        abbreviation: drv.name_acronym,
        teamColour: drv.team_colour,
        x: entry.x,
        y: entry.y,
        position: entry.position,
      });
    }
    return result;
  }, [drivers, positionIdx, rs.currentTime]);

  // Current weather at playhead
  const currentWeather = useMemo((): OF1Weather | null => {
    return bisectRight(weatherIdx, rs.currentTime);
  }, [weatherIdx, rs.currentTime]);

  // ── Actions ────────────────────────────────────────────
  const play = useCallback(() => setRs(p => ({ ...p, playing: true })), []);
  const pause = useCallback(() => setRs(p => ({ ...p, playing: false })), []);
  const scrub = useCallback((t: number) => setRs(p => ({ ...p, currentTime: t, playing: false })), []);
  const setSpeed = useCallback((s: number) => setRs(p => ({ ...p, speed: s })), []);

  return {
    selectedSession,
    drivers, laps, carDataMap, raceControl, stints, pits, intervals,
    loading, loadingCarData, error,
    rs, minTime, maxTime,
    stintIdx,
    towerRows, totalLaps, highlightedCarData,
    driverMarkers, trackPoints,
    currentWeather,
    play, pause, scrub, setSpeed,
  };
}
