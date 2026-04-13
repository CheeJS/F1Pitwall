import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  OF1,
  type OF1Session, type OF1Meeting, type OF1Driver, type OF1Lap, type OF1CarData,
  type OF1RaceControl, type OF1Stint, type OF1Pit, type OF1Interval,
  type OF1Position, type OF1Weather, type OF1Overtake,
  type OF1SessionResult,
} from '../api/openf1Direct';
import type { DriverMarker, CircuitEnrichment } from '../components/TrackMap';
import {
  type ReplayState, type TowerRow,
  parseDate, bisectRight, gapSortKey, isQualiSession,
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
  meeting_key?: number;
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
  meeting: OF1Meeting | null;

  // Data
  drivers: OF1Driver[];
  laps: OF1Lap[];
  carDataMap: Map<number, OF1CarData[]>;
  raceControl: OF1RaceControl[];
  stints: OF1Stint[];
  pits: OF1Pit[];
  intervals: OF1Interval[];
  overtakes: OF1Overtake[];
  positions: OF1Position[];
  weather: OF1Weather[];
  sessionResults: OF1SessionResult[];

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
  isQualifying: boolean;
  lapMarkers: { t: number; lap: number }[];

  // Track map
  driverMarkers: DriverMarker[];
  trackPoints: { x: number; y: number }[] | null;
  circuitInfo: CircuitEnrichment | null;

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
  const [overtakes, setOvertakes] = useState<OF1Overtake[]>([]);
  const [sessionResults, setSessionResults] = useState<OF1SessionResult[]>([]);
  const [positions, setPositions] = useState<OF1Position[]>([]);
  const [weather, setWeather] = useState<OF1Weather[]>([]);
  const [meeting, setMeeting] = useState<OF1Meeting | null>(null);
  const [trackPoints, setTrackPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [circuitInfo, setCircuitInfo] = useState<CircuitEnrichment | null>(null);
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
          meeting_key: session.meeting_key ?? 0,
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
    setMeeting(null);
    setDrivers([]);
    setLaps([]);
    setCarDataMap(new Map());
    setRaceControl([]);
    setStints([]);
    setPits([]);
    setIntervals([]);
    setOvertakes([]);
    setSessionResults([]);
    setPositions([]);
    setWeather([]);
    setTrackPoints(null);
    setCircuitInfo(null);
    setRs({ currentTime: parseDate(selectedSession.date_start), playing: false, speed: 4 });

    // Fetch all data in parallel — CDN-cached responses make 429s unlikely.
    const load = async () => {
      try {
        const mk = selectedSession.meeting_key;
        const isQual = isQualiSession(selectedSession.session_type);

        const [
          meetingRes, drvs, lapData, stintsRes,
          rc, pitsRes, intervalsRes, overtakesRes,
          posRes, weatherRes, resultsRes,
        ] = await Promise.allSettled([
          mk ? OF1.meetings({ meeting_key: mk }, ac.signal) : Promise.resolve([]),
          OF1.drivers({ session_key: sk }, ac.signal),
          OF1.laps({ session_key: sk }, ac.signal),
          OF1.stints({ session_key: sk }, ac.signal),
          OF1.raceControl({ session_key: sk }, ac.signal),
          OF1.pits({ session_key: sk }, ac.signal),
          OF1.intervals({ session_key: sk }, ac.signal),
          isQual ? Promise.resolve([] as OF1Overtake[]) : OF1.overtakes({ session_key: sk }, ac.signal),
          OF1.position({ session_key: sk }, ac.signal),
          OF1.weather({ session_key: sk }, ac.signal),
          OF1.sessionResults({ session_key: sk }, ac.signal),
        ]);
        if (ac.signal.aborted) return;

        if (meetingRes.status === 'fulfilled' && meetingRes.value.length) setMeeting(meetingRes.value[0]);
        if (drvs.status === 'fulfilled') setDrivers(drvs.value);
        if (lapData.status === 'fulfilled') {
          setLaps(lapData.value);
          let earliest = Infinity;
          for (const l of lapData.value) {
            if (l.date_start) {
              const t = parseDate(l.date_start);
              if (t < earliest) earliest = t;
            }
          }
          if (earliest !== Infinity) {
            setRs(prev => ({ ...prev, currentTime: earliest }));
          }
        }
        if (stintsRes.status === 'fulfilled') setStints(stintsRes.value);
        if (rc.status === 'fulfilled') setRaceControl(rc.value);
        if (pitsRes.status === 'fulfilled') setPits(pitsRes.value);
        if (intervalsRes.status === 'fulfilled') setIntervals(intervalsRes.value);
        if (overtakesRes.status === 'fulfilled') setOvertakes(overtakesRes.value);
        if (posRes.status === 'fulfilled') setPositions(posRes.value);
        if (weatherRes.status === 'fulfilled') setWeather(weatherRes.value);
        if (resultsRes.status === 'fulfilled') setSessionResults(resultsRes.value);
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
    if (!selectedSession) return;
    const ac = new AbortController();

    const applyLayout = (ck: number, yr: number) => {
      OF1.circuitLayout(ck, yr, ac.signal)
        .then(layout => {
          if (!layout || ac.signal.aborted) return;
          setTrackPoints(layout.x.map((x, i) => ({ x, y: layout.y[i] })));
          setCircuitInfo({
            corners: (layout.corners ?? []).map(c => ({
              number: c.number, letter: c.letter,
              x: c.trackPosition.x, y: c.trackPosition.y,
            })),
          });
        })
        .catch(() => {});
    };

    if (selectedSession.circuit_key) {
      applyLayout(selectedSession.circuit_key, selectedSession.year);
    } else {
      // circuit_key not provided (history mode passes 0) — resolve from OpenF1
      OF1.sessions({ session_key: selectedSession.session_key }, ac.signal)
        .then(sessions => {
          const ck = sessions[0]?.circuit_key;
          if (ck && !ac.signal.aborted) {
            applyLayout(ck, sessions[0].year || selectedSession.year);
          }
        })
        .catch(() => {});
    }

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
              const sorted = [...data]
              .sort((a, b) => parseDate(a.date) - parseDate(b.date))
              .map(d => ({ ...d, gear: d.n_gear ?? d.gear ?? 0 }));
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
    const m = new Map<number, Array<{ t: number; lapNumber: number; lapDuration: number | null; s1: number | null; s2: number | null; s3: number | null; seg1: number[] | null; seg2: number[] | null; seg3: number[] | null; stSpeed: number | null }>>();
    for (const l of laps) {
      if (!l.date_start) continue;
      const arr = m.get(l.driver_number) ?? [];
      arr.push({ t: parseDate(l.date_start), lapNumber: l.lap_number, lapDuration: l.lap_duration, s1: l.duration_sector_1, s2: l.duration_sector_2, s3: l.duration_sector_3, seg1: l.segments_sector_1, seg2: l.segments_sector_2, seg3: l.segments_sector_3, stSpeed: l.st_speed });
      m.set(l.driver_number, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    return m;
  }, [laps]);

  /** Per-driver O(1) lookup of LapEntry by lap_number. Previously this was
   *  rebuilt inside the towerRows loop on every render (O(drivers × laps)). */
  const lapByNumberIdx = useMemo(() => {
    const m = new Map<number, Map<number, NonNullable<ReturnType<typeof lapIdx.get>>[number]>>();
    for (const [dn, arr] of lapIdx) {
      const byNum = new Map<number, typeof arr[number]>();
      for (const e of arr) byNum.set(e.lapNumber, e);
      m.set(dn, byNum);
    }
    return m;
  }, [lapIdx]);

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

  // Lap boundary markers for the scrubber: earliest date_start per lap number across all drivers
  const lapMarkers = useMemo((): { t: number; lap: number }[] => {
    if (!laps.length) return [];
    const byLap = new Map<number, number>();
    for (const l of laps) {
      if (!l.date_start || l.lap_number <= 1) continue;
      const t = parseDate(l.date_start);
      const cur = byLap.get(l.lap_number);
      if (cur === undefined || t < cur) byLap.set(l.lap_number, t);
    }
    return Array.from(byLap.entries())
      .map(([lap, t]) => ({ lap, t }))
      .sort((a, b) => a.lap - b.lap);
  }, [laps]);


  // positionIdx: race standings only (P1, P2…) — no GPS.
  // GPS is derived from lap timing + circuit path in driverMarkers below.
  const positionIdx = useMemo(() => {
    const m = new Map<number, Array<{ t: number; position: number }>>();
    for (const p of positions) {
      const arr = m.get(p.driver_number) ?? [];
      arr.push({ t: parseDate(p.date), position: p.position });
      m.set(p.driver_number, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    return m;
  }, [positions]);

  const weatherIdx = useMemo(() => {
    return weather.map(w => ({ t: parseDate(w.date), ...w })).sort((a, b) => a.t - b.t);
  }, [weather]);

  const overtakesIdx = useMemo(() => {
    const m = new Map<number, Array<{ t: number }>>();
    for (const ov of overtakes) {
      const arr = m.get(ov.overtaking_driver_number) ?? [];
      arr.push({ t: parseDate(ov.date) });
      m.set(ov.overtaking_driver_number, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.t - b.t);
    return m;
  }, [overtakes]);

  // Qualifying segment boundaries detected from quiet periods in lap data.
  // A gap > 5 min where no driver starts any lap = inter-segment break (Q1→Q2 or Q2→Q3).
  // This is more reliable than CHEQUERED FLAG race_control messages, which vary in format.
  const qualiSegmentBounds = useMemo((): [number | null, number | null] => {
    if (!isQualiSession(selectedSession?.session_type ?? '') || !laps.length) return [null, null];
    const starts = laps
      .filter(l => l.date_start)
      .map(l => parseDate(l.date_start))
      .sort((a, b) => a - b);
    if (starts.length < 4) return [null, null];
    const GAP_MS = 5 * 60 * 1000; // 5-minute quiet period = segment break
    const bounds: number[] = [];
    for (let i = 1; i < starts.length; i++) {
      if (starts[i] - starts[i - 1] > GAP_MS) {
        // Use the first lap start of the new segment as the boundary.
        // The midpoint was incorrect: at t=midpoint no driver has Q2 laps yet,
        // causing all drivers to be falsely Q1-eliminated for several minutes.
        bounds.push(starts[i]);
        if (bounds.length === 2) break;
      }
    }
    return [bounds[0] ?? null, bounds[1] ?? null];
  }, [selectedSession?.session_type, laps]);

  // ── Computed values ────────────────────────────────────

  const towerRows = useMemo((): TowerRow[] => {
    const t = rs.currentTime;
    if (!drivers.length || t <= 0) return [];

    const isQualifying = isQualiSession(selectedSession?.session_type ?? '');

    // Pre-compute the leader's current lap so we can detect retired drivers
    // (2+ laps behind the leader = very likely retired, not just lapped).
    let maxLap = 0;
    for (const drv of drivers) {
      const entry = bisectRight(lapIdx.get(drv.driver_number) ?? [], t);
      if (entry && entry.lapNumber > maxLap) maxLap = entry.lapNumber;
    }

    // Grid position tiebreaker: used when gap data isn't available yet (start of race)
    const gridPosMap = new Map<number, number>();
    for (const drv of drivers) {
      gridPosMap.set(
        drv.driver_number,
        bisectRight(positionIdx.get(drv.driver_number) ?? [], t)?.position ?? 99,
      );
    }

    // Session fastest and per-segment bests.
    // Only count laps fully completed at time t — historical data has lap_duration pre-filled.
    const sessionFastest = { time: Infinity };
    const sessionQ1Best = { time: Infinity };
    const sessionQ2Best = { time: Infinity };
    const sessionQ3Best = { time: Infinity };
    const [sqB1, sqB2] = isQualifying ? qualiSegmentBounds : [null, null];

    for (const drv of drivers) {
      const dLaps = lapIdx.get(drv.driver_number) ?? [];
      for (const l of dLaps) {
        if (l.t > t) break;
        if (l.lapDuration === null || l.lapDuration <= 0 || l.t + l.lapDuration * 1000 > t) continue;
        if (l.lapDuration < sessionFastest.time) sessionFastest.time = l.lapDuration;
        if (isQualifying) {
          if (sqB1 === null || l.t < sqB1) {
            if (l.lapDuration < sessionQ1Best.time) sessionQ1Best.time = l.lapDuration;
          } else if (sqB2 === null || l.t < sqB2) {
            if (l.lapDuration < sessionQ2Best.time) sessionQ2Best.time = l.lapDuration;
          } else {
            if (l.lapDuration < sessionQ3Best.time) sessionQ3Best.time = l.lapDuration;
          }
        }
      }
    }

    const rows = drivers.map(drv => {
      const dn = drv.driver_number;

      // All laps for this driver sorted by start time
      const dLaps = lapIdx.get(dn) ?? [];

      // Current lap: most recent lap that has started (whether complete or not)
      const lapEntry = bisectRight(dLaps, t);
      const currentLap = lapEntry?.lapNumber ?? 0;

      // Last COMPLETED lap: the most recent lap where start + duration <= t.
      // We cannot use lapEntry directly — historical data has lap_duration pre-filled,
      // so a lap that started 30s ago with a 83s duration must not be treated as complete.
      let lastCompletedLap: typeof dLaps[0] | null = null;
      for (const l of dLaps) {
        if (l.t > t) break;
        if (l.lapDuration !== null && l.lapDuration > 0 && l.t + l.lapDuration * 1000 <= t) {
          lastCompletedLap = l;
        }
      }
      const lastLapTime = lastCompletedLap?.lapDuration ?? null;

      const iv = bisectRight(intervalIdx.get(dn) ?? [], t);

      const dStints = stintIdx.get(dn) ?? [];
      const currentStint =
        dStints.find(s => currentLap >= s.lap_start && currentLap <= (s.lap_end ?? Infinity)) ??
        (dStints.length ? dStints[dStints.length - 1] : null);

      // inPits: derived from stint transitions, not pits.date (whose semantics are ambiguous).
      // A driver is in pits from the moment their in-lap completes until their out-lap begins.
      // in-lap = dStints[i-1].lap_end, out-lap = dStints[i].lap_start
      const lapByNumber = lapByNumberIdx.get(dn) ?? new Map();
      let inPits = false;
      for (let si = 1; si < dStints.length; si++) {
        const inLapNum = dStints[si - 1].lap_end;
        const outLapNum = dStints[si].lap_start;
        if (inLapNum == null || outLapNum == null) continue;
        const inLap = lapByNumber.get(inLapNum);
        const outLap = lapByNumber.get(outLapNum);
        if (!inLap || !outLap) continue;
        if (inLap.lapDuration === null || inLap.lapDuration <= 0) continue;
        const pitStart = inLap.t + inLap.lapDuration * 1000;
        if (t >= pitStart && t < outLap.t) { inPits = true; break; }
      }

      const gap = iv?.gap ?? null;
      const lapElapsed = lapEntry ? t - lapEntry.t : 0;
      const lapExpectedMs = (lapEntry?.lapDuration ?? 90) * 1000;
      const lapsBehind = maxLap - currentLap;

      // Retirement detection — only for races; qualifying uses qualiOut instead.
      // A driver is OUT if they are 2+ laps behind the leader, OR 1 lap behind and their
      // current lap has been running for >3x the expected duration (i.e. they've stopped).
      // We do NOT use gap_to_leader strings — OpenF1 uses "1 LAP"/"2 LAPS" for lapped cars,
      // but other string values (empty, "0", etc.) are just missing data, not retirements.
      const isOut = !isQualifying && (
        (lapsBehind >= 2)
        || (lapsBehind >= 1 && lapElapsed > lapExpectedMs * 3.0 && lapExpectedMs > 0)
      );

      // bestLapTime + per-segment times: minimum lap_duration among COMPLETED laps up to t
      let bestLapTime: number | null = null;
      let bestLapEntry: typeof dLaps[0] | null = null;
      let q1Time: number | null = null;
      let q2Time: number | null = null;
      let q3Time: number | null = null;
      for (const l of dLaps) {
        if (l.t > t) break;
        if (l.lapDuration === null || l.lapDuration <= 0 || l.t + l.lapDuration * 1000 > t) continue;
        if (bestLapTime === null || l.lapDuration < bestLapTime) {
          bestLapTime = l.lapDuration;
          bestLapEntry = l;
        }
        if (isQualifying) {
          if (sqB1 === null || l.t < sqB1) {
            if (q1Time === null || l.lapDuration < q1Time) q1Time = l.lapDuration;
          } else if (sqB2 === null || l.t < sqB2) {
            if (q2Time === null || l.lapDuration < q2Time) q2Time = l.lapDuration;
          } else {
            if (q3Time === null || l.lapDuration < q3Time) q3Time = l.lapDuration;
          }
        }
      }
      const isFastestLap = bestLapTime !== null && bestLapTime === sessionFastest.time && sessionFastest.time !== Infinity;
      const isPersonalBest = lastLapTime !== null && bestLapTime !== null && lastLapTime === bestLapTime;
      const q1IsFastest = q1Time !== null && q1Time === sessionQ1Best.time && sessionQ1Best.time !== Infinity;
      const q2IsFastest = q2Time !== null && q2Time === sessionQ2Best.time && sessionQ2Best.time !== Infinity;
      const q3IsFastest = q3Time !== null && q3Time === sessionQ3Best.time && sessionQ3Best.time !== Infinity;

      // Sectors: qualifying → from best lap; race → from last completed lap
      const sectorSource = isQualifying ? bestLapEntry : lastCompletedLap;
      const s1 = sectorSource?.s1 ?? null;
      const s2 = sectorSource?.s2 ?? null;
      const s3 = sectorSource?.s3 ?? null;
      const seg1 = sectorSource?.seg1 ?? null;
      const seg2 = sectorSource?.seg2 ?? null;
      const seg3 = sectorSource?.seg3 ?? null;
      // Speed trap: always from the last completed lap (most recent reading)
      const stSpeed = lastCompletedLap?.stSpeed ?? null;
      // Overtakes made by this driver up to current playhead time
      const overtakeCount = isQualifying ? 0 : (overtakesIdx.get(dn) ?? []).filter(o => o.t <= t).length;

      // Qualifying segment elimination detection.
      // A driver is "Q1 out" if Q1 has ended and they have no laps in Q2.
      // A driver is "Q2 out" if Q2 has ended and they have no laps in Q3.
      let qualiOut: string | null = null;
      if (isQualifying) {
        const hasAnyLap = dLaps.some(l => l.t <= t);
        // sqB1/sqB2 are now the start time of the FIRST lap in Q2/Q3 respectively.
        // Use >= so that first-lap drivers aren't falsely marked eliminated.
        // 3-min grace period: Q2-eligible drivers need time to exit pit and start a lap.
        const GRACE_MS = 3 * 60_000;
        if (hasAnyLap && sqB1 !== null && t > sqB1 + GRACE_MS) {
          const hasQ2Lap = dLaps.some(l => l.t >= sqB1 && l.t <= t);
          if (!hasQ2Lap) qualiOut = 'Q1';
        }
        if (qualiOut === null && sqB2 !== null && t > sqB2 + GRACE_MS) {
          const hasQ3Lap = dLaps.some(l => l.t >= sqB2 && l.t <= t);
          if (!hasQ3Lap && hasAnyLap) qualiOut = 'Q2';
        }
      }

      return {
        driverNumber: dn,
        abbreviation: drv.name_acronym,
        teamColour: drv.team_colour,
        position: 0,
        currentLap,
        lastLapTime,
        s1, s2, s3,
        seg1, seg2, seg3,
        stSpeed,
        overtakeCount,
        gap,
        interval: iv?.interval ?? null,
        compound: currentStint?.compound ?? null,
        tyreAge: currentStint ? currentLap - currentStint.lap_start + currentStint.tyre_age_at_start : null,
        inPits,
        isOut,
        bestLapTime,
        isFastestLap,
        isPersonalBest,
        qualiOut,
        pitStops: Math.max(0, dStints.length - 1),
        q1Time, q2Time, q3Time,
        q1IsFastest, q2IsFastest, q3IsFastest,
      } satisfies TowerRow;
    });

    if (isQualifying) {
      // Determine which segment is currently active so we rank by the right time.
      const inQ3 = sqB2 !== null && t > sqB2;
      const inQ2 = !inQ3 && sqB1 !== null && t > sqB1;

      // The time relevant for ranking a driver:
      //   active → current segment's best  (Q3 > Q2 > Q1)
      //   Q2-out → their Q2 best (or Q1 if no Q2 time somehow)
      //   Q1-out → their Q1 best
      const segTime = (r: TowerRow): number | null => {
        if (!r.qualiOut) {
          if (inQ3) return r.q3Time;
          if (inQ2) return r.q2Time;
          return r.q1Time;
        }
        if (r.qualiOut === 'Q2') return r.q2Time ?? r.q1Time;
        return r.q1Time;
      };

      // Groups (lower = higher in the tower):
      //   0: active, has current-segment time
      //   1: active, no time yet in current segment
      //   2: Q2-eliminated, has time
      //   3: Q2-eliminated, no time
      //   4: Q1-eliminated, has time
      //   5: Q1-eliminated, no time
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
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      });

      // Gap to pole and interval to car directly ahead, both based on segTime
      const poleTime = segTime(rows[0]);
      rows.forEach((r, i) => {
        const rt = segTime(r);
        if (i === 0 || poleTime === null || rt === null) {
          r.gap = null;
          r.interval = null;
        } else {
          r.gap = rt - poleTime;
          const prevTime = segTime(rows[i - 1]);
          r.interval = prevTime !== null ? rt - prevTime : null;
        }
      });
    } else {
      rows.sort((a, b) => {
        if (b.currentLap !== a.currentLap) return b.currentLap - a.currentLap;
        const da = gapSortKey(a.gap), db = gapSortKey(b.gap);
        if (da !== db) return da - db;
        // Tiebreaker: live race position (gives correct starting grid order at race start)
        return (gridPosMap.get(a.driverNumber) ?? 99) - (gridPosMap.get(b.driverNumber) ?? 99);
      });
    }
    rows.forEach((r, i) => { r.position = i + 1; });
    return rows;
  }, [rs.currentTime, drivers, lapIdx, lapByNumberIdx, intervalIdx, stintIdx, positionIdx, selectedSession?.session_type, qualiSegmentBounds, overtakesIdx]);

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
    // Need both drivers and circuit layout — nothing to show without either
    if (!drivers.length || !trackPoints || trackPoints.length <= 10) return [];

    const result: DriverMarker[] = [];
    for (const drv of drivers) {
      const dn = drv.driver_number;

      // GPS: derived from lap timing + circuit path.
      // /position has no GPS (standings only); /location is too large to cache.
      // Instead: compute lap fraction = elapsed / lap_duration and map to a
      // circuit path index. Approximate (linear, no speed variation) but correct.
      const dLaps = lapIdx.get(dn);
      if (!dLaps?.length) continue;
      const lapEntry = bisectRight(dLaps, t);
      if (!lapEntry) continue;
      const elapsed = t - lapEntry.t;
      const lapDurMs = (lapEntry.lapDuration ?? 90) * 1000;

      // Skip retired drivers — they've been stationary for >3× a lap duration
      if (elapsed > lapDurMs * 3.0 && lapDurMs > 0) continue;

      const frac = Math.max(0, Math.min(1, elapsed / lapDurMs));
      // Lerp between adjacent track points for sub-pixel smooth movement
      const exactIdx = frac * (trackPoints.length - 1);
      const ptLo = trackPoints[Math.floor(exactIdx)];
      const ptHi = trackPoints[Math.min(Math.floor(exactIdx) + 1, trackPoints.length - 1)];
      if (!ptLo) continue;
      const f = exactIdx - Math.floor(exactIdx);
      const pt = {
        x: ptLo.x + f * (ptHi.x - ptLo.x),
        y: ptLo.y + f * (ptHi.y - ptLo.y),
      };

      // Race position number: prefer frequent /position updates, fall back to tower
      const posEntry = bisectRight(positionIdx.get(dn) ?? [], t);
      const racePos = posEntry?.position
        ?? towerRows.find(r => r.driverNumber === dn)?.position
        ?? 0;

      result.push({
        driverNumber: dn,
        abbreviation: drv.name_acronym,
        teamColour: drv.team_colour,
        x: pt.x,
        y: pt.y,
        position: racePos,
      });
    }
    return result;
  }, [drivers, positionIdx, lapIdx, trackPoints, towerRows, rs.currentTime]);

  // Current weather at playhead
  const currentWeather = useMemo((): OF1Weather | null => {
    return bisectRight(weatherIdx, rs.currentTime);
  }, [weatherIdx, rs.currentTime]);

  // ── Actions ────────────────────────────────────────────
  const play = useCallback(() => setRs(p => ({ ...p, playing: true })), []);
  const pause = useCallback(() => setRs(p => ({ ...p, playing: false })), []);
  const scrub = useCallback((t: number) => setRs(p => ({ ...p, currentTime: t, playing: false })), []);
  const setSpeed = useCallback((s: number) => setRs(p => ({ ...p, speed: s })), []);

  const isQualifying = isQualiSession(selectedSession?.session_type ?? '');

  return {
    selectedSession, meeting,
    drivers, laps, carDataMap, raceControl, stints, pits, intervals,
    overtakes, positions, weather, sessionResults,
    loading, loadingCarData, error,
    rs, minTime, maxTime,
    stintIdx,
    towerRows, totalLaps, highlightedCarData,
    isQualifying, lapMarkers,
    driverMarkers, trackPoints, circuitInfo,
    currentWeather,
    play, pause, scrub, setSpeed,
  };
}
