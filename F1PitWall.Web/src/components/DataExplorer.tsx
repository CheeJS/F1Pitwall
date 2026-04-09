import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  OF1,
  type OF1Session, type OF1Driver, type OF1CarData, type OF1Lap,
  type OF1Interval, type OF1Stint, type OF1Pit, type OF1Weather,
  type OF1RaceControl, type OF1ChampionshipDriver, type OF1ChampionshipTeam,
  type OF1Position, type OF1TeamRadio,
} from '../api/openf1Direct';
import type { EndpointId } from './ExplorerSidebar';
import { ENDPOINTS } from './ExplorerSidebar';
import { LineChart, HBarChart, GanttChart, ChartLegend, downsample, type ChartSeries, type BarItem, type GanttRow } from './ChartPrimitives';

// ── Constants ─────────────────────────────────────────────

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: '#ef4444', MEDIUM: '#eab308', HARD: '#e4e4e7',
  INTER: '#22c55e', WET: '#3b82f6',
};

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${sec}` : s.toFixed(3);
}
function fmtElapsed(secs: number): string {
  const m = Math.floor(Math.abs(secs) / 60);
  const s = Math.floor(Math.abs(secs) % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function parseDateMs(s: string): number { return new Date(s).getTime(); }
function parseGap(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace('+', ''));
  return isNaN(n) ? null : n;
}

// Endpoints that require driver_number (high-frequency → 422 without it)
const NEEDS_DRIVER: Set<EndpointId> = new Set(['car_data', 'location', 'position']);
const NEEDS_SESSION: Set<EndpointId> = new Set([
  'car_data', 'location', 'position', 'drivers', 'laps', 'intervals',
  'stints', 'team_radio', 'weather', 'race_control', 'pit', 'session_result', 'starting_grid',
]);
const AUTO_YEAR: Set<EndpointId> = new Set(['sessions', 'meetings', 'drivers_championship', 'team_championship']);

// ── Helpers ───────────────────────────────────────────────

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[…${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

function deriveColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const row of rows.slice(0, 20)) for (const k of Object.keys(row)) keys.add(k);
  return Array.from(keys);
}

const PAGE_SIZE = 50;

// ── Pickers ───────────────────────────────────────────────

function YearPicker({ value, onChange }: { value: number; onChange: (y: number) => void }) {
  return (
    <div className="de-picker-years">
      {[2022, 2023, 2024, 2025, 2026].map(y => (
        <button key={y} className={`de-year-btn${value === y ? ' active' : ''}`} onClick={() => onChange(y)}>{y}</button>
      ))}
    </div>
  );
}

function SessionPicker({ year, value, onChange }: { year: number; value: number | null; onChange: (k: number | null) => void }) {
  const [sessions, setSessions] = useState<OF1Session[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    onChange(null);
    OF1.sessions({ year }, ac.signal)
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="de-session-picker">
      <div className="de-picker-label">Session</div>
      <select
        className="de-picker-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={loading || !sessions.length}
      >
        <option value="">— select session —</option>
        {sessions.map(s => (
          <option key={s.session_key} value={s.session_key}>
            {s.circuit_short_name} · {s.session_name} ({s.year})
          </option>
        ))}
      </select>
      {loading && <span className="spinner" />}
    </div>
  );
}

function DriverPicker({ sessionKey, value, onChange }: { sessionKey: number | null; value: number | null; onChange: (n: number | null) => void }) {
  const [drivers, setDrivers] = useState<OF1Driver[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionKey) { setDrivers([]); onChange(null); return; }
    const ac = new AbortController();
    setLoading(true);
    OF1.drivers({ session_key: sessionKey }, ac.signal)
      .then(d => { setDrivers(d); if (d.length) onChange(d[0].driver_number); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="de-session-picker">
      <div className="de-picker-label">Driver</div>
      <select
        className="de-picker-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={loading || !drivers.length}
      >
        <option value="">— select driver —</option>
        {drivers.map(d => (
          <option key={d.driver_number} value={d.driver_number}>
            #{d.driver_number} {d.name_acronym} · {d.team_name}
          </option>
        ))}
      </select>
      {loading && <span className="spinner" />}
    </div>
  );
}

// ── Per-endpoint chart views ───────────────────────────────

function CarDataCharts({ data }: { data: OF1CarData[] }) {
  const sorted = useMemo(() => [...data].sort((a, b) => parseDateMs(a.date) - parseDateMs(b.date)), [data]);
  if (!sorted.length) return <div className="chart-no-data">No car data</div>;
  const t0 = parseDateMs(sorted[0].date);
  const mkS = (key: keyof OF1CarData, name: string, color: string, area = false): ChartSeries => ({
    id: key as string, name, color, area,
    points: downsample(sorted, 800).map(d => ({ x: (parseDateMs(d.date) - t0) / 1000, y: Number(d[key] ?? 0) })),
  });
  const xFmt = fmtElapsed;
  return (
    <div className="chart-grid-stack">
      <LineChart series={[mkS('speed', 'Speed', 'var(--blue)')]} title="Speed (km/h)" xFmt={xFmt} yFmt={v => `${v.toFixed(0)}`} yMin={0} yMax={360} height={160} yAxisW={40} />
      <LineChart series={[mkS('throttle', 'Throttle', 'var(--green)', true), mkS('brake', 'Brake', 'var(--red)', true)]} title="Throttle / Brake (%)" xFmt={xFmt} yFmt={v => `${v.toFixed(0)}`} yMin={0} yMax={100} height={140} />
      <LineChart series={[mkS('rpm', 'RPM', 'var(--yellow)')]} title="RPM" xFmt={xFmt} yFmt={v => v.toFixed(0)} yMin={0} yMax={16000} height={140} yAxisW={52} />
      <LineChart series={[mkS('gear', 'Gear', 'var(--purple)')]} title="Gear" xFmt={xFmt} yFmt={v => v.toFixed(0)} yMin={0} yMax={9} height={110} />
    </div>
  );
}

function LapsCharts({ data, drivers }: { data: OF1Lap[]; drivers: OF1Driver[] }) {
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.driver_number, d])), [drivers]);
  const byDriver = useMemo(() => {
    const m = new Map<number, OF1Lap[]>();
    for (const l of data) { if (!m.has(l.driver_number)) m.set(l.driver_number, []); m.get(l.driver_number)!.push(l); }
    return m;
  }, [data]);
  const series: ChartSeries[] = useMemo(() =>
    Array.from(byDriver.entries()).map(([dn, laps]) => {
      const drv = driverMap.get(dn);
      const color = drv?.team_colour ? `#${drv.team_colour}` : '#888888';
      const pts = laps.filter(l => l.lap_duration !== null && l.lap_duration > 0 && l.lap_duration < 200)
        .map(l => ({ x: l.lap_number, y: l.lap_duration! }));
      return { id: String(dn), name: drv?.name_acronym ?? String(dn), color, points: pts };
    }).filter(s => s.points.length > 0),
    [byDriver, driverMap]);
  const bestLaps: BarItem[] = useMemo(() => {
    const items = series.map(s => {
      if (!s.points.length) return null;
      const best = Math.min(...s.points.map(p => p.y));
      return { id: s.id, label: s.name, sublabel: fmtSecs(best), value: best, color: s.color };
    }).filter(Boolean) as BarItem[];
    return items.sort((a, b) => a.value - b.value);
  }, [series]);
  const minLap = bestLaps[0]?.value ?? 80;
  return (
    <div className="chart-grid-stack">
      <LineChart series={series} title="Lap times · all drivers" xFmt={v => `L${v.toFixed(0)}`} yFmt={fmtSecs} height={280} yAxisW={66} />
      <ChartLegend series={series} />
      <HBarChart items={bestLaps.map(b => ({ ...b, sublabel: fmtSecs(b.value), value: +(b.value - minLap + 0.001).toFixed(3) }))} title="Best lap delta to fastest" xFmt={v => `+${v.toFixed(3)}s`} />
    </div>
  );
}

function IntervalsChart({ data, drivers }: { data: OF1Interval[]; drivers: OF1Driver[] }) {
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.driver_number, d])), [drivers]);
  const t0 = useMemo(() => { const all = data.map(d => parseDateMs(d.date)); return all.length ? Math.min(...all) : 0; }, [data]);
  const byDriver = useMemo(() => {
    const m = new Map<number, OF1Interval[]>();
    for (const r of data) { if (!m.has(r.driver_number)) m.set(r.driver_number, []); m.get(r.driver_number)!.push(r); }
    return m;
  }, [data]);
  const series: ChartSeries[] = useMemo(() =>
    Array.from(byDriver.entries()).map(([dn, rows]) => {
      const drv = driverMap.get(dn);
      const color = drv?.team_colour ? `#${drv.team_colour}` : '#888888';
      const pts = rows.filter(r => { const g = parseGap(r.gap_to_leader); return g !== null && g < 120; })
        .map(r => ({ x: (parseDateMs(r.date) - t0) / 1000, y: parseGap(r.gap_to_leader) ?? 0 }));
      return { id: String(dn), name: drv?.name_acronym ?? String(dn), color, points: pts };
    }).filter(s => s.points.length > 0),
    [byDriver, driverMap, t0]);
  return (
    <div className="chart-grid-stack">
      <LineChart series={series} title="Gap to leader" xFmt={fmtElapsed} yFmt={v => `+${v.toFixed(1)}s`} height={280} />
      <ChartLegend series={series} />
    </div>
  );
}

function PositionChart({ data, drivers }: { data: OF1Position[]; drivers: OF1Driver[] }) {
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.driver_number, d])), [drivers]);
  const t0 = useMemo(() => { const all = data.map(d => parseDateMs(d.date)); return all.length ? Math.min(...all) : 0; }, [data]);
  const byDriver = useMemo(() => {
    const m = new Map<number, OF1Position[]>();
    for (const r of data) { if (!m.has(r.driver_number)) m.set(r.driver_number, []); m.get(r.driver_number)!.push(r); }
    return m;
  }, [data]);
  const series: ChartSeries[] = useMemo(() =>
    Array.from(byDriver.entries()).map(([dn, rows]) => {
      const drv = driverMap.get(dn);
      const color = drv?.team_colour ? `#${drv.team_colour}` : '#888888';
      const pts = rows.filter(r => r.position >= 1 && r.position <= 20)
        .map(r => ({ x: (parseDateMs(r.date) - t0) / 1000, y: r.position }));
      return { id: String(dn), name: drv?.name_acronym ?? String(dn), color, points: pts };
    }).filter(s => s.points.length > 0),
    [byDriver, driverMap, t0]);
  return (
    <div className="chart-grid-stack">
      <LineChart series={series} title="Race position over time" xFmt={fmtElapsed} yFmt={v => `P${v.toFixed(0)}`} height={340} yMin={1} yMax={20} invertY />
      <ChartLegend series={series} />
    </div>
  );
}

function WeatherCharts({ data }: { data: OF1Weather[] }) {
  const sorted = useMemo(() => [...data].sort((a, b) => parseDateMs(a.date) - parseDateMs(b.date)), [data]);
  if (!sorted.length) return <div className="chart-no-data">No weather data</div>;
  const t0 = parseDateMs(sorted[0].date);
  const mkS = (key: keyof OF1Weather, name: string, color: string, area = false): ChartSeries => ({
    id: key as string, name, color, area,
    points: sorted.map(d => ({ x: (parseDateMs(d.date) - t0) / 1000, y: Number(d[key] ?? 0) })),
  });
  const xFmt = fmtElapsed;
  return (
    <div className="chart-grid-stack">
      <LineChart series={[mkS('track_temperature', 'Track', '#ef4444'), mkS('air_temperature', 'Air', '#f97316')]} title="Temperature (°C)" xFmt={xFmt} yFmt={v => `${v.toFixed(1)}°`} height={200} yAxisW={44} />
      <LineChart series={[mkS('humidity', 'Humidity', 'var(--blue)', true)]} title="Humidity (%)" xFmt={xFmt} yFmt={v => `${v.toFixed(0)}%`} yMin={0} yMax={100} height={160} />
      <LineChart series={[mkS('wind_speed', 'Wind speed', 'var(--purple)', true)]} title="Wind speed (m/s)" xFmt={xFmt} yFmt={v => `${v.toFixed(1)}`} height={160} />
      <LineChart series={[mkS('rainfall', 'Rainfall', 'var(--blue)', true)]} title="Rainfall" xFmt={xFmt} yFmt={v => v.toFixed(0)} yMin={0} height={130} />
    </div>
  );
}

function StintsChart({ data, drivers }: { data: OF1Stint[]; drivers: OF1Driver[] }) {
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.driver_number, d])), [drivers]);
  const rows: GanttRow[] = useMemo(() => {
    const byDriver = new Map<number, OF1Stint[]>();
    for (const s of data) { if (!byDriver.has(s.driver_number)) byDriver.set(s.driver_number, []); byDriver.get(s.driver_number)!.push(s); }
    return Array.from(byDriver.entries()).sort((a, b) => a[0] - b[0]).map(([dn, stints]) => {
      const drv = driverMap.get(dn);
      return {
        id: String(dn), label: drv?.name_acronym ?? String(dn),
        segments: stints.map(s => ({
          start: s.lap_start, end: s.lap_end ?? s.lap_start + 1,
          color: COMPOUND_COLOR[s.compound?.toUpperCase()] ?? '#888',
          bg: '#1a1a1a',
          label: s.compound?.charAt(0) ?? '?',
        })),
      };
    });
  }, [data, driverMap]);
  const usedCompounds = useMemo(() => Array.from(new Set(data.map(d => d.compound?.toUpperCase()).filter(Boolean))), [data]);
  return (
    <div className="chart-grid-stack">
      <GanttChart rows={rows} title="Tyre stints" xLabel="Lap" />
      <div className="chart-legend">
        {usedCompounds.map(c => (
          <span key={c} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: COMPOUND_COLOR[c as string] }} />{c}
          </span>
        ))}
      </div>
    </div>
  );
}

function PitChart({ data, drivers }: { data: OF1Pit[]; drivers: OF1Driver[] }) {
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.driver_number, d])), [drivers]);
  const items: BarItem[] = useMemo(() =>
    data.filter(p => p.pit_duration !== null && p.pit_duration > 0)
      .sort((a, b) => (a.pit_duration ?? 0) - (b.pit_duration ?? 0))
      .map(p => {
        const drv = driverMap.get(p.driver_number);
        return { id: `${p.driver_number}_${p.lap_number}`, label: drv?.name_acronym ?? String(p.driver_number), sublabel: `L${p.lap_number}`, value: p.pit_duration ?? 0, color: drv?.team_colour ? `#${drv.team_colour}` : '#888' };
      }),
    [data, driverMap]);
  return <HBarChart items={items} title="Pit stop durations" xFmt={v => `${v.toFixed(2)}s`} />;
}

function ChampionshipChart({ data, type }: { data: OF1ChampionshipDriver[] | OF1ChampionshipTeam[]; type: 'driver' | 'team' }) {
  const items: BarItem[] = useMemo(() => {
    if (type === 'driver') {
      return (data as OF1ChampionshipDriver[]).sort((a, b) => a.position - b.position).map(r => ({
        id: String(r.driver_number), label: r.name_acronym ?? r.broadcast_name, sublabel: r.team_name, value: r.points, color: r.team_colour ? `#${r.team_colour}` : '#888',
      }));
    }
    return (data as OF1ChampionshipTeam[]).sort((a, b) => a.position - b.position).map(r => ({
      id: r.team_name, label: r.team_name, value: r.points, color: r.team_colour ? `#${r.team_colour}` : '#888',
    }));
  }, [data, type]);
  return <HBarChart items={items} title={`${type === 'driver' ? 'Drivers' : 'Constructors'} championship – points`} />;
}

function RaceControlView({ data }: { data: OF1RaceControl[] }) {
  const FLAG_COLOR: Record<string, string> = {
    YELLOW_FLAG: 'var(--yellow)', RED_FLAG: 'var(--red)', BLUE_FLAG: 'var(--blue)',
    GREEN_FLAG: 'var(--green)', SAFETY_CAR: 'var(--yellow)', VIRTUAL_SAFETY_CAR: 'var(--yellow)',
    DRS_ENABLED: 'var(--green)', DRS_DISABLED: 'var(--text-muted)',
  };
  const sorted = [...data].sort((a, b) => parseDateMs(a.date) - parseDateMs(b.date));
  return (
    <div className="rc-list">
      {sorted.map((m, i) => {
        const key = (m.flag ?? m.category ?? '').toUpperCase().replace(/\s+/g, '_');
        const color = FLAG_COLOR[key] ?? 'var(--text-muted)';
        return (
          <div key={i} className="rc-item" style={{ borderLeftColor: color }}>
            <span className="rc-time">{new Date(m.date).toISOString().slice(11, 19)}</span>
            {m.lap_number && <span className="rc-lap">L{m.lap_number}</span>}
            {m.driver_number && <span className="rc-driver">#{m.driver_number}</span>}
            <span className="rc-msg">{m.message}</span>
            {m.flag && <span className="rc-flag" style={{ color }}>{m.flag.replace(/_/g, ' ')}</span>}
          </div>
        );
      })}
    </div>
  );
}

function DriversView({ data }: { data: OF1Driver[] }) {
  return (
    <div className="driver-cards">
      {data.map(d => (
        <div key={d.driver_number} className="driver-card" style={{ borderTopColor: d.team_colour ? `#${d.team_colour}` : 'var(--border)' }}>
          {d.headshot_url && <img src={d.headshot_url} alt={d.full_name} className="driver-card-img" loading="lazy" />}
          <div className="driver-card-num" style={{ color: d.team_colour ? `#${d.team_colour}` : undefined }}>#{d.driver_number}</div>
          <div className="driver-card-name">{d.full_name}</div>
          <div className="driver-card-team">{d.team_name}</div>
          <div className="driver-card-country">{d.country_code}</div>
        </div>
      ))}
    </div>
  );
}

function SessionsView({ data }: { data: OF1Session[] }) {
  return (
    <div className="session-cards">
      {data.map(s => (
        <div key={s.session_key} className="session-card">
          <span className="session-card-key">#{s.session_key}</span>
          <div className="session-card-body">
            <span className="session-card-circuit">{s.circuit_short_name}</span>
            <span className="session-card-name">{s.session_name} · {s.session_type}</span>
            <span className="session-card-country">{s.country_name} · {s.year}</span>
          </div>
          <span className="session-card-date">{s.date_start?.slice(0, 10)}</span>
        </div>
      ))}
    </div>
  );
}

function TeamRadioView({ data, drivers }: { data: OF1TeamRadio[]; drivers: OF1Driver[] }) {
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.driver_number, d])), [drivers]);
  return (
    <div className="radio-list">
      {data.map((r, i) => {
        const drv = driverMap.get(r.driver_number);
        return (
          <div key={i} className="radio-item">
            <div className="radio-item-meta">
              <span className="radio-item-driver" style={{ color: drv?.team_colour ? `#${drv.team_colour}` : undefined }}>
                {drv?.name_acronym ?? `#${r.driver_number}`}
              </span>
              <span className="radio-item-time">{new Date(r.date).toISOString().slice(11, 19)}</span>
            </div>
            <audio controls src={r.recording_url} className="radio-audio" preload="none" />
          </div>
        );
      })}
    </div>
  );
}

function ChartView({ endpointId, data, drivers }: { endpointId: EndpointId; data: unknown[]; drivers: OF1Driver[] }) {
  switch (endpointId) {
    case 'car_data':    return <CarDataCharts data={data as OF1CarData[]} />;
    case 'laps':        return <LapsCharts data={data as OF1Lap[]} drivers={drivers} />;
    case 'intervals':   return <IntervalsChart data={data as OF1Interval[]} drivers={drivers} />;
    case 'position':    return <PositionChart data={data as OF1Position[]} drivers={drivers} />;
    case 'weather':     return <WeatherCharts data={data as OF1Weather[]} />;
    case 'stints':      return <StintsChart data={data as OF1Stint[]} drivers={drivers} />;
    case 'pit':         return <PitChart data={data as OF1Pit[]} drivers={drivers} />;
    case 'drivers_championship': return <ChampionshipChart data={data as OF1ChampionshipDriver[]} type="driver" />;
    case 'team_championship':    return <ChampionshipChart data={data as OF1ChampionshipTeam[]} type="team" />;
    case 'race_control': return <RaceControlView data={data as OF1RaceControl[]} />;
    case 'drivers':     return <DriversView data={data as OF1Driver[]} />;
    case 'sessions':    return <SessionsView data={data as OF1Session[]} />;
    case 'team_radio':  return <TeamRadioView data={data as OF1TeamRadio[]} drivers={drivers} />;
    default:            return <TableView data={data as Record<string, unknown>[]} />;
  }
}

// ── Fallback table ────────────────────────────────────────

function TableView({ data }: { data: Record<string, unknown>[] }) {
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const columns = useMemo(() => deriveColumns(data), [data]);
  const sorted = useMemo(() => {
    if (!sortCol) return data;
    return [...data].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      const cmp = isNaN(Number(av)) || isNaN(Number(bv)) ? fmtVal(av).localeCompare(fmtVal(bv)) : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortCol, sortDir]);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  return (
    <>
      <div className="de-table-wrap">
        <table className="de-table">
          <thead>
            <tr>{columns.map(col => (
              <th key={col} className={`de-th${sortCol === col ? ' sorted' : ''}`} onClick={() => handleSort(col)}>
                {col}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => (
              <tr key={i} className="de-tr">
                {columns.map(col => (
                  <td key={col} className={`de-td${col.includes('date') ? ' de-td-mono' : ''}`}>
                    {col === 'recording_url' && row[col]
                      ? <audio controls src={String(row[col])} className="de-audio" />
                      : fmtVal(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > PAGE_SIZE && (
        <div className="de-pagination">
          <button className="de-page-btn" disabled={page === 0} onClick={() => setPage(0)}>«</button>
          <button className="de-page-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
          <span className="de-page-info">{page + 1} / {totalPages}</span>
          <button className="de-page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
          <button className="de-page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
        </div>
      )}
    </>
  );
}

// ── DataExplorer ──────────────────────────────────────────

interface Props {
  endpointId: EndpointId;
}

export function DataExplorer({ endpointId }: Props) {
  const [data, setData]         = useState<unknown[]>([]);
  const [drivers, setDrivers]   = useState<OF1Driver[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [view, setView]         = useState<'chart' | 'table' | 'json'>('chart');
  const [year, setYear]         = useState(2024);
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [driverNum, setDriverNum]   = useState<number | null>(null);

  const meta        = ENDPOINTS.find(e => e.id === endpointId)!;
  const needsSession = NEEDS_SESSION.has(endpointId);
  const needsDriver  = NEEDS_DRIVER.has(endpointId);
  const autoYear     = AUTO_YEAR.has(endpointId);
  const jsonRef      = useRef<HTMLPreElement>(null);

  // Reset on endpoint change
  useEffect(() => {
    setData([]); setError(null); setLoading(false); setView('chart'); setDriverNum(null);
  }, [endpointId]);

  // Load driver list for colour mapping in charts
  useEffect(() => {
    if (!sessionKey) { setDrivers([]); return; }
    const ac = new AbortController();
    OF1.drivers({ session_key: sessionKey }, ac.signal).then(setDrivers).catch(() => {});
    return () => ac.abort();
  }, [sessionKey]);

  const doFetch = useCallback((signal: AbortSignal): Promise<unknown[]> => {
    switch (endpointId) {
      case 'sessions':             return OF1.sessions({ year }, signal);
      case 'meetings':             return OF1.meetings({ year }, signal);
      case 'drivers':              return OF1.drivers({ session_key: sessionKey! }, signal);
      case 'laps':                 return OF1.laps({ session_key: sessionKey! }, signal);
      case 'car_data':             return OF1.carData({ session_key: sessionKey!, driver_number: driverNum! }, signal);
      case 'intervals':            return OF1.intervals({ session_key: sessionKey! }, signal);
      case 'stints':               return OF1.stints({ session_key: sessionKey! }, signal);
      case 'team_radio':           return OF1.teamRadio({ session_key: sessionKey! }, signal);
      case 'weather':              return OF1.weather({ session_key: sessionKey! }, signal);
      case 'race_control':         return OF1.raceControl({ session_key: sessionKey! }, signal);
      case 'pit':                  return OF1.pits({ session_key: sessionKey! }, signal);
      case 'location':             return OF1.location({ session_key: sessionKey!, driver_number: driverNum! }, signal);
      case 'position':             return OF1.position({ session_key: sessionKey!, driver_number: driverNum ?? undefined }, signal);
      case 'drivers_championship': return OF1.driverChampionship({}, signal);
      case 'team_championship':    return OF1.teamChampionship({}, signal);
      case 'session_result':       return OF1.sessionResults({ session_key: sessionKey! }, signal);
      case 'starting_grid':        return OF1.startingGrid({ session_key: sessionKey! }, signal);
      default:                     return Promise.resolve([]);
    }
  }, [endpointId, sessionKey, driverNum, year]);

  // Auto-fetch for year-only endpoints
  useEffect(() => {
    if (!autoYear) return;
    const ac = new AbortController();
    setLoading(true); setError(null); setData([]);
    doFetch(ac.signal).then(d => setData(d)).catch(e => { if (e.name !== 'AbortError') setError(String(e.message)); }).finally(() => setLoading(false));
    return () => ac.abort();
  }, [autoYear, doFetch]);

  const handleFetch = useCallback(() => {
    const ac = new AbortController();
    setLoading(true); setError(null); setData([]);
    doFetch(ac.signal).then(d => setData(d)).catch(e => { if (e.name !== 'AbortError') setError(String(e.message)); }).finally(() => setLoading(false));
  }, [doFetch]);

  const canFetch = needsSession
    ? sessionKey !== null && (!needsDriver || driverNum !== null)
    : true;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${endpointId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="de-root">
      {/* Toolbar */}
      <div className="de-toolbar">
        <div className="de-toolbar-left">
          <span className="de-endpoint-badge">{endpointId}</span>
          <span className="de-endpoint-desc">{meta.description}</span>
          {meta.realtimeCapable && <span className="de-rt-chip"><span className="de-rt-dot" />Real-time</span>}
        </div>
        <div className="de-toolbar-right">
          {data.length > 0 && (
            <button className="de-btn de-btn-ghost" onClick={downloadJson}>
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v8M4 6l3 3 3-3M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2" /></svg>
              Export
            </button>
          )}
          <div className="de-view-toggle">
            <button className={`de-view-btn${view === 'chart' ? ' active' : ''}`} onClick={() => setView('chart')}>Chart</button>
            <button className={`de-view-btn${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>Table</button>
            <button className={`de-view-btn${view === 'json' ? ' active' : ''}`} onClick={() => setView('json')}>JSON</button>
          </div>
        </div>
      </div>

      {/* Controls */}
      {(needsSession || autoYear) && (
        <div className="de-controls">
          <YearPicker value={year} onChange={setYear} />
          {needsSession && <SessionPicker year={year} value={sessionKey} onChange={setSessionKey} />}
          {needsDriver && sessionKey && <DriverPicker sessionKey={sessionKey} value={driverNum} onChange={setDriverNum} />}
          {needsSession && (
            <button className="de-btn de-btn-primary" disabled={loading || !canFetch} onClick={handleFetch}>
              {loading ? <><span className="spinner" /> Loading…</> : 'Load data'}
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      {data.length > 0 && (
        <div className="de-stats-bar">
          <span className="de-stats-count">{data.length.toLocaleString()} records</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="de-state error">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="7" /><path d="M8 5v4M8 11v.5" /></svg>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && <div className="de-state"><span className="spinner" /> Fetching data…</div>}

      {/* Empty guidance */}
      {!loading && !error && data.length === 0 && needsSession && (
        <div className="de-empty-guide">
          <div className="de-empty-title">Select a session{needsDriver ? ' and driver' : ''}</div>
          <div className="de-empty-sub">
            {needsDriver
              ? 'This endpoint requires both a session and a specific driver — it returns too many records otherwise.'
              : 'Pick a session above then click Load data.'}
          </div>
        </div>
      )}

      {/* Main content */}
      {!loading && data.length > 0 && (
        <div className="de-content">
          {view === 'chart' && (
            <div className="de-chart-area">
              <ChartView endpointId={endpointId} data={data} drivers={drivers} />
            </div>
          )}
          {view === 'table' && <TableView data={data as Record<string, unknown>[]} />}
          {view === 'json' && (
            <div className="de-json-wrap">
              <pre ref={jsonRef} className="de-json">{JSON.stringify(data.slice(0, 500), null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
