import { useState, useEffect } from 'react';
import type { F1Session } from '../types';
import {
  OF1,
  type OF1Driver, type OF1Lap, type OF1Stint, type OF1Pit,
  type OF1Interval, type OF1Weather, type OF1RaceControl,
  type OF1SessionResult, type OF1StartingGrid,
} from '../api/openf1Direct';
import {
  LineChart, HBarChart, GanttChart,
  type ChartSeries, type BarItem, type GanttRow, type GanttSegment,
  downsample,
} from './ChartPrimitives';

// ── Helpers ────────────────────────────────────────────────

function normalizeColor(c: string | null | undefined): string {
  if (!c) return '#888888';
  return c.startsWith('#') ? c : `#${c}`;
}

function fmtLap(s: number | null): string {
  if (s === null) return '—';
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${rem}` : s.toFixed(3);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const COMPOUND_COLORS: Record<string, { bg: string; fg: string }> = {
  SOFT:         { bg: '#e10600', fg: '#fff' },
  MEDIUM:       { bg: '#ffd700', fg: '#000' },
  HARD:         { bg: '#d4d4d4', fg: '#000' },
  INTERMEDIATE: { bg: '#39b54a', fg: '#fff' },
  INTER:        { bg: '#39b54a', fg: '#fff' },
  WET:          { bg: '#0067ff', fg: '#fff' },
  HYPERSOFT:    { bg: '#ff77ff', fg: '#000' },
  ULTRASOFT:    { bg: '#9b59b6', fg: '#fff' },
  SUPERSOFT:    { bg: '#e74c3c', fg: '#fff' },
};

function compoundStyle(c: string) {
  return COMPOUND_COLORS[(c ?? '').toUpperCase()] ?? { bg: '#888', fg: '#fff' };
}

const FLAG_COLORS: Record<string, string> = {
  GREEN:     '#39b54a',
  YELLOW:    '#ffd700',
  DOUBLE_YELLOW: '#ffd700',
  RED:       '#e10600',
  BLUE:      '#0067ff',
  BLACK:     '#555',
  CHEQUERED: '#e5e5e5',
  WHITE:     '#e5e5e5',
};

function flagColor(flag: string | null): string {
  if (!flag) return 'var(--border-strong)';
  return FLAG_COLORS[flag.toUpperCase()] ?? 'var(--border-strong)';
}

function buildDriverMap(drivers: OF1Driver[]): Map<number, OF1Driver> {
  return new Map(drivers.map(d => [d.driver_number, d]));
}

// ── Session Hero ───────────────────────────────────────────

interface HeroProps {
  session: F1Session;
  weather: OF1Weather[];
  results: OF1SessionResult[];
  drivers: OF1Driver[];
  onWatchReplay?: (sk: number) => void;
}

function SessionHero({ session, weather, results, drivers, onWatchReplay }: HeroProps) {
  const winner = results.find(r => r.position === 1);
  const winnerDriver = winner ? drivers.find(d => d.driver_number === winner.driver_number) : null;
  const lastWeather = weather.length ? weather[weather.length - 1] : null;

  const badgeClass = () => {
    const t = session.sessionType;
    if (t === 'Race') return 'badge-race';
    if (t === 'Sprint') return 'badge-sprint';
    if (t.toLowerCase().includes('qualifying')) return 'badge-qualifying';
    return 'badge-practice';
  };

  return (
    <div className="sdb-hero">
      <div className="sdb-hero-left">
        <div className="sdb-hero-top">
          <span className={`session-badge ${badgeClass()}`}>{session.sessionType}</span>
          <span className="sdb-hero-year">{session.year}</span>
        </div>
        <h2 className="sdb-hero-title">{session.meetingName}</h2>
        <div className="sdb-hero-meta">
          <span>{session.circuitShortName}</span>
          <span className="sdb-dot">·</span>
          <span>{session.countryName}</span>
          <span className="sdb-dot">·</span>
          <span>{fmtDate(session.dateStart)}</span>
        </div>
        {winnerDriver && (
          <div className="sdb-winner">
            <span className="sdb-winner-trophy">🏆</span>
            <span
              className="sdb-winner-abbr"
              style={{ color: normalizeColor(winnerDriver.team_colour) }}
            >
              {winnerDriver.name_acronym}
            </span>
            <span className="sdb-winner-name">{winnerDriver.full_name}</span>
            <span className="sdb-winner-team">{winnerDriver.team_name}</span>
          </div>
        )}
      </div>

      <div className="sdb-hero-right">
        {lastWeather && (
          <div className="sdb-weather-snap">
            <div className="sdb-weather-row">
              <span className="sdb-weather-label">Track</span>
              <span className="sdb-weather-val">{lastWeather.track_temperature.toFixed(1)}°C</span>
            </div>
            <div className="sdb-weather-row">
              <span className="sdb-weather-label">Air</span>
              <span className="sdb-weather-val">{lastWeather.air_temperature.toFixed(1)}°C</span>
            </div>
            <div className="sdb-weather-row">
              <span className="sdb-weather-label">Humidity</span>
              <span className="sdb-weather-val">{lastWeather.humidity.toFixed(0)}%</span>
            </div>
            <div className="sdb-weather-row">
              <span className="sdb-weather-label">Wind</span>
              <span className="sdb-weather-val">{lastWeather.wind_speed.toFixed(1)} m/s</span>
            </div>
          </div>
        )}
        {onWatchReplay && (
          <button
            className="sdb-replay-btn"
            onClick={() => onWatchReplay(session.sessionKey)}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
              <path d="M3 2v12l11-6Z" />
            </svg>
            Watch Replay
          </button>
        )}
      </div>
    </div>
  );
}

// ── Final Classification ───────────────────────────────────

interface ResultsTableProps {
  results: OF1SessionResult[];
  drivers: OF1Driver[];
  laps: OF1Lap[];
}

function ResultsTable({ results, drivers, laps }: ResultsTableProps) {
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const driverMap = buildDriverMap(drivers);

  return (
    <div className="sdb-card">
      <div className="sdb-card-title">Final Classification</div>
      <table className="sdb-results-table">
        <thead>
          <tr>
            <th>P</th>
            <th>Driver</th>
            <th>Team</th>
            <th>Best Lap</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 20).map(r => {
            const drv = driverMap.get(r.driver_number);
            const driverLaps = laps.filter(l => l.driver_number === r.driver_number && l.lap_duration !== null && !l.is_pit_out_lap);
            const bestLap = driverLaps.length
              ? Math.min(...driverLaps.map(l => l.lap_duration!))
              : null;
            return (
              <tr key={r.driver_number} className={r.position === 1 ? 'sdb-winner-row' : ''}>
                <td className="sdb-pos">{r.position}</td>
                <td className="sdb-driver-cell">
                  {drv && (
                    <span
                      className="sdb-driver-bar"
                      style={{ background: normalizeColor(drv.team_colour) }}
                    />
                  )}
                  <span className="sdb-driver-abbr">{drv?.name_acronym ?? `#${r.driver_number}`}</span>
                  <span className="sdb-driver-full">{drv?.full_name ?? ''}</span>
                </td>
                <td className="sdb-team">{drv?.team_name ?? '—'}</td>
                <td className="sdb-best-lap">{fmtLap(bestLap)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Grid vs Result ─────────────────────────────────────────

interface GridVsResultProps {
  results: OF1SessionResult[];
  startingGrid: OF1StartingGrid[];
  drivers: OF1Driver[];
}

function GridVsResult({ results, startingGrid, drivers }: GridVsResultProps) {
  const driverMap = buildDriverMap(drivers);
  const resultMap = new Map(results.map(r => [r.driver_number, r.position]));
  const gridMap   = new Map(startingGrid.map(g => [g.driver_number, g.grid_position]));

  const entries = [...results]
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .slice(0, 16)
    .map(r => ({
      driverNumber: r.driver_number,
      finalPos:     resultMap.get(r.driver_number) ?? 0,
      gridPos:      gridMap.get(r.driver_number)   ?? 0,
      driver:       driverMap.get(r.driver_number),
    }))
    .filter(e => e.gridPos > 0);

  if (entries.length === 0) return null;

  return (
    <div className="sdb-card">
      <div className="sdb-card-title">Grid → Finish</div>
      <div className="sdb-grid-table">
        {entries.map(e => {
          const gained = e.gridPos - e.finalPos;
          const color  = normalizeColor(e.driver?.team_colour);
          return (
            <div key={e.driverNumber} className="sdb-grid-row">
              <span className="sdb-grid-pos sdb-grid-start">{e.gridPos}</span>
              <span className="sdb-grid-arrow">→</span>
              <span className="sdb-grid-pos sdb-grid-end">{e.finalPos}</span>
              <span className="sdb-grid-abbr" style={{ color }}>
                {e.driver?.name_acronym ?? `#${e.driverNumber}`}
              </span>
              <span className={`sdb-grid-delta ${gained > 0 ? 'gain' : gained < 0 ? 'loss' : 'neutral'}`}>
                {gained > 0 ? `▲${gained}` : gained < 0 ? `▼${Math.abs(gained)}` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Race Control Timeline ──────────────────────────────────

interface RCTimelineProps { events: OF1RaceControl[]; }

function RaceControlTimeline({ events }: RCTimelineProps) {
  // Prefer flag/SC events; fall back to all events
  const filtered = events.filter(e =>
    e.flag || e.category === 'SafetyCar' || e.category === 'Flag' || e.category === 'Drs'
  );
  const display = filtered.length > 0 ? filtered : events.slice(0, 40);

  return (
    <div className="sdb-card sdb-full">
      <div className="sdb-card-title">Race Control</div>
      <div className="sdb-rc-scroll">
        {display.map((ev, i) => {
          const fc = flagColor(ev.flag);
          return (
            <div
              key={i}
              className="sdb-rc-pill"
              style={{ borderColor: fc, background: `${fc}22` }}
              title={ev.message}
            >
              {ev.lap_number != null && (
                <span className="sdb-rc-lap">L{ev.lap_number}</span>
              )}
              <span className="sdb-rc-msg">
                {ev.message.length > 70 ? `${ev.message.slice(0, 70)}…` : ev.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Lap Times Chart ────────────────────────────────────────

interface LapTimeChartProps {
  laps: OF1Lap[];
  drivers: OF1Driver[];
  results: OF1SessionResult[];
}

function LapTimesChart({ laps, drivers, results }: LapTimeChartProps) {
  const topNums: number[] = results.length
    ? [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).slice(0, 10).map(r => r.driver_number)
    : [...new Set(laps.map(l => l.driver_number))].slice(0, 10);

  const driverMap = buildDriverMap(drivers);

  // IQR-based outlier filter
  const valid = laps.filter(l => l.lap_duration !== null && !l.is_pit_out_lap).map(l => l.lap_duration!);
  const sorted = [...valid].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? Infinity;
  const maxLapTime = q3 + (q3 - q1) * 2;

  const series: ChartSeries[] = topNums.map(dn => {
    const drv = driverMap.get(dn);
    const pts = laps
      .filter(l =>
        l.driver_number === dn &&
        l.lap_duration !== null &&
        !l.is_pit_out_lap &&
        l.lap_duration < maxLapTime
      )
      .sort((a, b) => a.lap_number - b.lap_number)
      .map(l => ({ x: l.lap_number, y: l.lap_duration! }));
    return {
      id: String(dn),
      name: drv?.name_acronym ?? `#${dn}`,
      color: normalizeColor(drv?.team_colour),
      points: pts,
    };
  }).filter(s => s.points.length > 1);

  if (series.length === 0) return null;

  return (
    <div className="sdb-card sdb-full">
      <LineChart
        series={series}
        title="Lap Times"
        yFmt={fmtLap}
        xFmt={n => `L${Math.round(n)}`}
        yLabel="Time"
        height={280}
      />
    </div>
  );
}

// ── Gap to Leader ──────────────────────────────────────────

interface GapChartProps {
  intervals: OF1Interval[];
  drivers: OF1Driver[];
  results: OF1SessionResult[];
}

function GapToLeaderChart({ intervals, drivers, results }: GapChartProps) {
  // Top P2–P7 (skip leader, whose gap is always 0)
  const topNums: number[] = results.length
    ? [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).slice(1, 7).map(r => r.driver_number)
    : [...new Set(intervals.map(i => i.driver_number))].slice(0, 6);

  const driverMap = buildDriverMap(drivers);

  const series: ChartSeries[] = topNums.map(dn => {
    const drv = driverMap.get(dn);
    const pts = intervals
      .filter(i => i.driver_number === dn && typeof i.gap_to_leader === 'number')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const sampled = downsample(pts, 300);
    return {
      id: String(dn),
      name: drv?.name_acronym ?? `#${dn}`,
      color: normalizeColor(drv?.team_colour),
      points: sampled.map((iv, idx) => ({
        x: idx,
        y: typeof iv.gap_to_leader === 'number' ? iv.gap_to_leader : 0,
      })),
    };
  }).filter(s => s.points.length > 1);

  if (series.length === 0) return null;

  return (
    <div className="sdb-card sdb-full">
      <LineChart
        series={series}
        title="Gap to Leader"
        yFmt={v => `+${v.toFixed(1)}s`}
        xFmt={() => ''}
        yLabel="Gap (s)"
        height={220}
      />
    </div>
  );
}

// ── Tyre Stints ────────────────────────────────────────────

interface StintsChartProps {
  stints: OF1Stint[];
  drivers: OF1Driver[];
  results: OF1SessionResult[];
}

function TyreStintsChart({ stints, drivers, results }: StintsChartProps) {
  const orderedNums: number[] = results.length
    ? [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).slice(0, 20).map(r => r.driver_number)
    : [...new Set(stints.map(s => s.driver_number))];

  const driverMap = buildDriverMap(drivers);

  const rows: GanttRow[] = orderedNums.map(dn => {
    const drv = driverMap.get(dn);
    const driverStints = stints
      .filter(s => s.driver_number === dn)
      .sort((a, b) => a.stint_number - b.stint_number);

    const segments: GanttSegment[] = driverStints.map(s => {
      const { bg, fg } = compoundStyle(s.compound);
      return {
        start: s.lap_start,
        end:   (s.lap_end ?? s.lap_start) + 1,
        color: fg,
        bg,
        label: (s.compound ?? '?').slice(0, 1).toUpperCase(),
      };
    });

    return {
      id:       String(dn),
      label:    drv?.name_acronym ?? `#${dn}`,
      sublabel: drv?.team_name,
      segments,
    };
  }).filter(r => r.segments.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="sdb-card sdb-full">
      <GanttChart rows={rows} title="Tyre Stints" xLabel="Lap" />
    </div>
  );
}

// ── Pit Stops ─────────────────────────────────────────────

interface PitStopsProps {
  pits: OF1Pit[];
  drivers: OF1Driver[];
  results: OF1SessionResult[];
}

function PitStopsChart({ pits, drivers, results }: PitStopsProps) {
  const driverMap = buildDriverMap(drivers);
  const valid = pits.filter(p => p.pit_duration !== null && p.pit_duration > 0 && p.pit_duration < 120);

  const byDriver = new Map<number, OF1Pit[]>();
  for (const p of valid) {
    if (!byDriver.has(p.driver_number)) byDriver.set(p.driver_number, []);
    byDriver.get(p.driver_number)!.push(p);
  }

  const orderedNums: number[] = results.length
    ? [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map(r => r.driver_number)
    : [...byDriver.keys()];

  const items: BarItem[] = orderedNums
    .filter(dn => byDriver.has(dn))
    .map(dn => {
      const drv   = driverMap.get(dn);
      const dPits = byDriver.get(dn)!;
      const avg   = dPits.reduce((s, p) => s + p.pit_duration!, 0) / dPits.length;
      return {
        id:       String(dn),
        label:    drv?.name_acronym ?? `#${dn}`,
        sublabel: `${dPits.length} stop${dPits.length !== 1 ? 's' : ''}`,
        value:    avg,
        color:    normalizeColor(drv?.team_colour),
      };
    });

  if (items.length === 0) return null;

  return (
    <div className="sdb-card sdb-full">
      <HBarChart
        items={items}
        title="Pit Stop Durations (avg)"
        xFmt={v => `${v.toFixed(1)}s`}
        xLabel="Time (s)"
      />
    </div>
  );
}

// ── Weather ────────────────────────────────────────────────

interface WeatherPanelProps { weather: OF1Weather[]; }

function WeatherPanel({ weather }: WeatherPanelProps) {
  const sampled = downsample(weather, 200);

  const trackSeries: ChartSeries = {
    id: 'track',
    name: 'Track Temp',
    color: '#e10600',
    points: sampled.map((w, i) => ({ x: i, y: w.track_temperature })),
  };

  const airSeries: ChartSeries = {
    id: 'air',
    name: 'Air Temp',
    color: '#6495ed',
    points: sampled.map((w, i) => ({ x: i, y: w.air_temperature })),
  };

  return (
    <div className="sdb-card sdb-full">
      <LineChart
        series={[trackSeries, airSeries]}
        title="Temperature"
        yFmt={v => `${v.toFixed(1)}°C`}
        xFmt={() => ''}
        yLabel="°C"
        height={180}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

interface Props {
  session: F1Session | null;
  onWatchReplay?: (sessionKey: number) => void;
}

export function SessionDashboard({ session, onWatchReplay }: Props) {
  const [drivers,      setDrivers]      = useState<OF1Driver[]>([]);
  const [laps,         setLaps]         = useState<OF1Lap[]>([]);
  const [stints,       setStints]       = useState<OF1Stint[]>([]);
  const [pits,         setPits]         = useState<OF1Pit[]>([]);
  const [intervals,    setIntervals]    = useState<OF1Interval[]>([]);
  const [weather,      setWeather]      = useState<OF1Weather[]>([]);
  const [raceControl,  setRaceControl]  = useState<OF1RaceControl[]>([]);
  const [results,      setResults]      = useState<OF1SessionResult[]>([]);
  const [startingGrid, setStartingGrid] = useState<OF1StartingGrid[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [loadedKey,    setLoadedKey]    = useState<number | null>(null);

  useEffect(() => {
    if (!session) return;
    const sk = session.sessionKey;
    if (sk === loadedKey) return;

    const ac = new AbortController();
    setLoading(true);
    setDrivers([]); setLaps([]); setStints([]); setPits([]);
    setIntervals([]); setWeather([]); setRaceControl([]); setResults([]); setStartingGrid([]);

    Promise.allSettled([
      OF1.drivers(      { session_key: sk }, ac.signal),
      OF1.laps(         { session_key: sk }, ac.signal),
      OF1.stints(       { session_key: sk }, ac.signal),
      OF1.pits(         { session_key: sk }, ac.signal),
      OF1.intervals(    { session_key: sk }, ac.signal),
      OF1.weather(      { session_key: sk }, ac.signal),
      OF1.raceControl(  { session_key: sk }, ac.signal),
      OF1.sessionResults({ session_key: sk }, ac.signal),
      OF1.startingGrid( { session_key: sk }, ac.signal),
    ]).then(([d, l, st, p, iv, w, rc, r, sg]) => {
      if (ac.signal.aborted) return;
      if (d.status  === 'fulfilled') setDrivers(d.value);
      if (l.status  === 'fulfilled') setLaps(l.value);
      if (st.status === 'fulfilled') setStints(st.value);
      if (p.status  === 'fulfilled') setPits(p.value);
      if (iv.status === 'fulfilled') setIntervals(iv.value);
      if (w.status  === 'fulfilled') setWeather(w.value);
      if (rc.status === 'fulfilled') setRaceControl(rc.value);
      if (r.status  === 'fulfilled') setResults(r.value);
      if (sg.status === 'fulfilled') setStartingGrid(sg.value);
      setLoadedKey(sk);
      setLoading(false);
    });

    return () => ac.abort();
  }, [session?.sessionKey, loadedKey]);

  if (!session) {
    return (
      <div className="session-dashboard sdb-empty">
        <div className="sdb-empty-icon">⏱</div>
        <p>Select a session from the list to view the full session dashboard.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="session-dashboard sdb-loading">
        <div className="sdb-loading-inner">
          <span className="spinner" />
          <span>Loading session data…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="session-dashboard">
      <SessionHero
        session={session}
        weather={weather}
        results={results}
        drivers={drivers}
        onWatchReplay={onWatchReplay}
      />

      <div className="sdb-body">
        {/* Results + Grid side by side */}
        {results.length > 0 && (
          <div className="sdb-pair-row">
            <ResultsTable results={results} drivers={drivers} laps={laps} />
            {startingGrid.length > 0 && (
              <GridVsResult results={results} startingGrid={startingGrid} drivers={drivers} />
            )}
          </div>
        )}

        {/* Race control events */}
        {raceControl.length > 0 && <RaceControlTimeline events={raceControl} />}

        {/* Lap times multi-driver */}
        {laps.length > 0 && <LapTimesChart laps={laps} drivers={drivers} results={results} />}

        {/* Gap to leader evolution */}
        {intervals.length > 0 && <GapToLeaderChart intervals={intervals} drivers={drivers} results={results} />}

        {/* Tyre strategy Gantt */}
        {stints.length > 0 && <TyreStintsChart stints={stints} drivers={drivers} results={results} />}

        {/* Pit stop durations */}
        {pits.length > 0 && <PitStopsChart pits={pits} drivers={drivers} results={results} />}

        {/* Weather */}
        {weather.length > 0 && <WeatherPanel weather={weather} />}
      </div>
    </div>
  );
}
