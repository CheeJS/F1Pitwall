import {
  useState, useEffect, useRef, useCallback, useMemo, memo
} from 'react';
import { OF1, type OF1Session, type OF1Driver, type OF1Lap, type OF1CarData, type OF1RaceControl, type OF1Stint, type OF1Pit, type OF1Interval } from '../api/openf1Direct';

// ── Types ─────────────────────────────────────────────────

interface ReplayState {
  currentTime: number; // ms since epoch (from date strings)
  playing: boolean;
  speed: number;       // playback multiplier: 1, 4, 8, 16
}

const SPEED_OPTIONS = [1, 4, 8, 16, 32] as const;

// ── Helpers ───────────────────────────────────────────────

function parseDate(s: string): number {
  return new Date(s).getTime();
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtLap(secs: number | null): string {
  if (secs === null) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${s}` : `${secs.toFixed(3)}`;
}

// ── Timing-tower helpers ──────────────────────────────────

function bisectRight<T extends { t: number }>(arr: T[], t: number): T | null {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 ? arr[hi] : null;
}

const COMPOUND_STYLE: Record<string, { bg: string; fg: string; abbr: string }> = {
  SOFT:         { bg: '#e8002d', fg: '#fff', abbr: 'S' },
  MEDIUM:       { bg: '#ffd700', fg: '#000', abbr: 'M' },
  HARD:         { bg: '#d0d0d0', fg: '#000', abbr: 'H' },
  INTERMEDIATE: { bg: '#39b54a', fg: '#fff', abbr: 'I' },
  WET:          { bg: '#0067ff', fg: '#fff', abbr: 'W' },
};

function gapSortKey(gap: number | string | null): number {
  if (gap === null) return 1e9;
  if (typeof gap === 'number') return gap;
  const m = /(\d+)\s+LAP/.exec(String(gap));
  return m ? 1e6 + parseInt(m[1]) * 1000 : 1e8;
}

function fmtGap(gap: number | string | null, position: number): string {
  if (position === 1) return 'LEADER';
  if (gap === null) return '—';
  if (typeof gap === 'string') return gap;
  return `+${gap.toFixed(3)}`;
}

function fmtInterval(interval: number | string | null): string {
  if (interval === null) return '—';
  if (typeof interval === 'string') return interval;
  return `+${interval.toFixed(3)}`;
}

// ── Timing Tower ─────────────────────────────────────────

interface TowerRow {
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
}

interface TowerProps {
  rows: TowerRow[];
  highlighted: number | null;
  onSelectDriver: (n: number | null) => void;
  totalLaps: number;
}

const TowerRowItem = memo(function TowerRowItem({
  row, highlighted, onSelectDriver, totalLaps,
}: { row: TowerRow; highlighted: number | null; onSelectDriver: (n: number | null) => void; totalLaps: number }) {
  const prevPos = useRef(row.position);
  const [flashClass, setFlashClass] = useState('');

  useEffect(() => {
    const prev = prevPos.current;
    if (prev !== 0 && prev !== row.position) {
      const cls = row.position < prev ? 'flash-up' : 'flash-down';
      setFlashClass(cls);
      const id = setTimeout(() => setFlashClass(''), 1200);
      prevPos.current = row.position;
      return () => clearTimeout(id);
    }
    prevPos.current = row.position;
  }, [row.position]);

  const isHighlighted = row.driverNumber === highlighted;
  const cs = COMPOUND_STYLE[row.compound ?? ''];

  return (
    <div
      className={`replay-tower-row${isHighlighted ? ' highlighted' : ''}${row.inPits ? ' in-pits' : ''}${flashClass ? ` ${flashClass}` : ''}`}
      style={{ borderLeft: `3px solid #${row.teamColour}` }}
      onClick={() => onSelectDriver(isHighlighted ? null : row.driverNumber)}
    >
      <span className="replay-tower-col-pos">{row.position}</span>
      <span className="replay-tower-col-name">{row.abbreviation}</span>
      <span className="replay-tower-col-tyre">
        {row.inPits ? (
          <span className="replay-tower-pit-badge">PIT</span>
        ) : cs ? (
          <span
            className="replay-tower-compound"
            style={{ background: cs.bg, color: cs.fg }}
            title={`${row.compound}${row.tyreAge !== null ? ` (${row.tyreAge} laps)` : ''}`}
          >
            {cs.abbr}
          </span>
        ) : <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>—</span>}
      </span>
      <span className="replay-tower-col-lap">
        {row.currentLap > 0 ? row.currentLap : '—'}
        {totalLaps > 0 && row.currentLap > 0 && <span className="replay-tower-laps-total">/{totalLaps}</span>}
      </span>
      <span className={`replay-tower-col-gap${row.position === 1 ? ' leader' : ''}`}>
        {fmtGap(row.gap, row.position)}
      </span>
      <span className="replay-tower-col-int">
        {row.position === 1 ? '—' : fmtInterval(row.interval)}
      </span>
      <span className="replay-tower-col-sector">{row.s1 !== null ? row.s1.toFixed(3) : '—'}</span>
      <span className="replay-tower-col-sector">{row.s2 !== null ? row.s2.toFixed(3) : '—'}</span>
      <span className="replay-tower-col-sector">{row.s3 !== null ? row.s3.toFixed(3) : '—'}</span>
      <span className="replay-tower-col-laptime">
        {fmtLap(row.lastLapTime)}
      </span>
    </div>
  );
});

function ReplayTimingTower({ rows, highlighted, onSelectDriver, totalLaps }: TowerProps) {
  if (!rows.length) return <div className="replay-tower-empty">No timing data yet</div>;

  return (
    <div className="replay-tower">
      <div className="replay-tower-header">
        <span>P</span>
        <span>Driver</span>
        <span title="Tyre">T</span>
        <span>Lap</span>
        <span>Gap</span>
        <span>Int</span>
        <span>S1</span>
        <span>S2</span>
        <span>S3</span>
        <span>Last</span>
      </div>
      <div className="replay-tower-rows">
        {rows.map(row => (
          <TowerRowItem
            key={row.driverNumber}
            row={row}
            highlighted={highlighted}
            onSelectDriver={onSelectDriver}
            totalLaps={totalLaps}
          />
        ))}
      </div>
    </div>
  );
}

// ── Session picker internal ───────────────────────────────

interface SessionPickerProps {
  selected: OF1Session | null;
  onSelect: (s: OF1Session) => void;
  sessions: OF1Session[];
  loading: boolean;
}

function SessionPickerBar({ selected, onSelect, sessions, loading }: SessionPickerProps) {
  // Group by meeting, race sessions first
  const races = sessions.filter(s => s.session_type === 'Race');
  return (
    <div className="replay-session-bar">
      <span className="replay-session-label">Session</span>
      <select
        className="replay-session-select"
        value={selected?.session_key ?? ''}
        onChange={e => {
          const s = sessions.find(x => x.session_key === Number(e.target.value));
          if (s) onSelect(s);
        }}
        disabled={loading}
      >
        <option value="">— select session —</option>
        {races.map(s => (
          <option key={s.session_key} value={s.session_key}>
            {s.year} · {s.circuit_short_name} · {s.session_name}
          </option>
        ))}
        {sessions.filter(s => s.session_type !== 'Race').map(s => (
          <option key={s.session_key} value={s.session_key}>
            {s.year} · {s.circuit_short_name} · {s.session_name}
          </option>
        ))}
      </select>
      {loading && <span className="spinner" style={{ marginLeft: 8 }} />}
    </div>
  );
}

// ── Replay Controls ───────────────────────────────────────

interface ControlsProps {
  rs: ReplayState;
  minTime: number;
  maxTime: number;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (t: number) => void;
  onSpeed: (s: number) => void;
}

function ReplayControls({ rs, minTime, maxTime, onPlay, onPause, onScrub, onSpeed }: ControlsProps) {
  const duration = maxTime - minTime;
  const elapsed  = rs.currentTime - minTime;
  const progress = duration > 0 ? (elapsed / duration) * 100 : 0;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    onScrub(minTime + (Number(e.target.value) / 100) * duration);
  };

  return (
    <div className="replay-controls">
      <button
        className="replay-play-btn"
        onClick={rs.playing ? onPause : onPlay}
        aria-label={rs.playing ? 'Pause' : 'Play'}
        disabled={duration === 0}
      >
        {rs.playing ? (
          <svg viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="1" width="4" height="12" rx="1"/>
            <rect x="8" y="1" width="4" height="12" rx="1"/>
          </svg>
        ) : (
          <svg viewBox="0 0 14 14" fill="currentColor">
            <path d="M3 1.5v11l9-5.5Z"/>
          </svg>
        )}
      </button>

      <div className="replay-timeline">
        <span className="replay-time-label">{formatDuration(elapsed)}</span>
        <input
          className="replay-scrubber"
          type="range"
          min={0}
          max={100}
          step={0.01}
          value={progress}
          onChange={handleScrub}
          disabled={duration === 0}
          aria-label="Timeline scrubber"
        />
        <span className="replay-time-label replay-time-total">{formatDuration(duration)}</span>
      </div>

      <div className="replay-speed-group">
        {SPEED_OPTIONS.map(spd => (
          <button
            key={spd}
            className={`replay-speed-btn${rs.speed === spd ? ' active' : ''}`}
            onClick={() => onSpeed(spd)}
          >
            {spd}×
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Race control messages (used inside chart panel) ──────────────────────────

interface MsgProps { messages: OF1RaceControl[]; currentTime: number; }

function RaceMessages({ messages, currentTime }: MsgProps) {
  const recent = useMemo(() => {
    return messages
      .filter(m => parseDate(m.date) <= currentTime)
      .slice(-5)
      .reverse();
  }, [messages, currentTime]);

  if (!recent.length) return null;

  return (
    <div className="replay-messages replay-messages-inline">
      <div className="replay-messages-title">Race Control</div>
      {recent.map((m, i) => (
        <div key={i} className={`replay-msg replay-msg-${(m.flag ?? m.category ?? 'info').toLowerCase().replace(/\s+/g,'_')}`}>
          <span className="replay-msg-time">{new Date(m.date).toISOString().slice(11, 19)}</span>
          <span className="replay-msg-text">{m.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Continuous Telemetry Chart ────────────────────────────

interface ChartChannel {
  key: 'speed' | 'throttle' | 'brake' | 'rpm' | 'gear';
  label: string;
  color: string;
  max: number;
  unit: string;
}

const CHANNELS: ChartChannel[] = [
  { key: 'speed',    label: 'Speed',    color: '#3b82f6', max: 360, unit: 'km/h' },
  { key: 'throttle', label: 'Throttle', color: '#22c55e', max: 100, unit: '%'    },
  { key: 'brake',    label: 'Brake',    color: '#ef4444', max: 100, unit: '%'    },
  { key: 'rpm',      label: 'RPM',      color: '#a855f7', max: 15000, unit: ''   },
  { key: 'gear',     label: 'Gear',     color: '#eab308', max: 8,   unit: ''     },
];

// Build SVG polyline points from car data array for a given channel
function buildPolylinePoints(
  data: OF1CarData[],
  key: ChartChannel['key'],
  minT: number,
  maxT: number,
  w: number,
  h: number,
  maxVal: number,
): string {
  if (!data.length || maxT <= minT) return '';
  const span = maxT - minT;
  const pts: string[] = [];
  for (const cd of data) {
    const t = parseDate(cd.date);
    const x = ((t - minT) / span) * w;
    const rawVal = cd[key] as number;
    const y = h - (Math.min(rawVal, maxVal) / maxVal) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

interface TelemetryChartProps {
  driverNumber: number;
  driverAbbr: string;
  teamColour: string;
  carData: OF1CarData[];
  laps: OF1Lap[];
  stints: OF1Stint[];
  raceControl: OF1RaceControl[];
  currentTime: number;
  minTime: number;
  maxTime: number;
  onScrub: (t: number) => void;
}

const TelemetryChart = memo(function TelemetryChart({
  driverAbbr,
  teamColour,
  carData,
  laps,
  stints,
  raceControl,
  currentTime,
  minTime,
  maxTime,
  onScrub,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const ROW_H = 56;
  const LABEL_W = 52;
  const chartW = width - LABEL_W;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = maxTime - minTime;
  const playheadX = span > 0 ? ((currentTime - minTime) / span) * chartW : 0;

  // Downsample car data for performance — one sample per ~300ms of real data
  const sampledData = useMemo(() => {
    if (!carData.length) return carData;
    const step = Math.max(1, Math.floor(carData.length / 3000));
    return carData.filter((_, i) => i % step === 0);
  }, [carData]);

  // Pit stop bands
  const pitBands = useMemo(() => {
    if (!span) return [];
    return laps
      .filter(l => l.is_pit_out_lap && l.date_start)
      .map(l => {
        const lapStart = parseDate(l.date_start);
        // approximate pit entry as one lap before
        const prevLap = laps.find(p => p.driver_number === l.driver_number && p.lap_number === l.lap_number - 1);
        const pitEntry = prevLap?.date_start ? parseDate(prevLap.date_start) + (prevLap.lap_duration ?? 20) * 1000 : lapStart - 25000;
        const x1 = ((pitEntry - minTime) / span) * chartW;
        const x2 = ((lapStart - minTime) / span) * chartW;
        return { x: x1, width: Math.max(2, x2 - x1) };
      });
  }, [laps, minTime, span, chartW]);

  // Safety car / flag events
  const flagEvents = useMemo(() => {
    if (!span) return [];
    return raceControl
      .filter(m => m.flag && ['YELLOW', 'RED', 'SAFETY_CAR', 'VSC'].includes(m.flag.toUpperCase()))
      .map(m => {
        const x = ((parseDate(m.date) - minTime) / span) * chartW;
        const color = m.flag?.toUpperCase() === 'RED' ? '#ef4444' : m.flag?.toUpperCase() === 'YELLOW' ? '#eab308' : '#3b82f6';
        return { x, color, label: m.flag ?? '' };
      });
  }, [raceControl, minTime, span, chartW]);

  // Lap tick marks (vertical lines at lap boundaries)
  const lapTicks = useMemo(() => {
    if (!span || !laps.length) return [];
    const lapStarts = new Map<number, number>();
    for (const l of laps) {
      if (l.date_start && !lapStarts.has(l.lap_number)) {
        lapStarts.set(l.lap_number, parseDate(l.date_start));
      }
    }
    return Array.from(lapStarts.entries())
      .filter(([n]) => n > 1)
      .map(([n, t]) => ({ x: ((t - minTime) / span) * chartW, lap: n }));
  }, [laps, minTime, span, chartW]);

  // Stint colour bands
  const stintBands = useMemo(() => {
    if (!span || !stints.length || !laps.length) return [];
    return stints.map(s => {
      const startLap = laps.find(l => l.lap_number === s.lap_start && l.date_start);
      const endLap = laps.find(l => l.lap_number === (s.lap_end ?? s.lap_start) && l.date_start);
      if (!startLap) return null;
      const x1 = ((parseDate(startLap.date_start) - minTime) / span) * chartW;
      const endT = endLap
        ? parseDate(endLap.date_start) + (endLap.lap_duration ?? 0) * 1000
        : maxTime;
      const x2 = ((endT - minTime) / span) * chartW;
      const cs = COMPOUND_STYLE[s.compound] ?? null;
      return { x: x1, width: Math.max(1, x2 - x1), color: cs?.bg ?? '#555', abbr: cs?.abbr ?? s.compound.charAt(0) };
    }).filter(Boolean) as { x: number; width: number; color: string; abbr: string }[];
  }, [stints, laps, minTime, maxTime, span, chartW]);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left - LABEL_W;
    const t = minTime + (relX / chartW) * span;
    onScrub(Math.max(minTime, Math.min(maxTime, t)));
  };

  const totalH = ROW_H * CHANNELS.length;

  return (
    <div className="tchart-wrap" ref={containerRef}>
      {/* Driver header */}
      <div className="tchart-driver-header" style={{ borderLeftColor: `#${teamColour}` }}>
        <span className="tchart-driver-abbr" style={{ color: `#${teamColour}` }}>{driverAbbr}</span>
        {carData.length === 0 && <span className="tchart-loading-hint">Loading telemetry…</span>}
      </div>

      {/* SVG chart */}
      <svg
        className="tchart-svg"
        width={width}
        height={totalH}
        onClick={handleClick}
        style={{ cursor: 'crosshair' }}
      >
        <defs>
          {CHANNELS.map(ch => (
            <clipPath key={ch.key} id={`clip-${ch.key}`}>
              <rect x={LABEL_W} y={0} width={chartW} height={totalH} />
            </clipPath>
          ))}
        </defs>

        {/* Stint colour bands (full height, very subtle) */}
        {stintBands.map((b, i) => (
          <rect
            key={i}
            x={LABEL_W + b.x}
            y={0}
            width={b.width}
            height={totalH}
            fill={b.color}
            opacity={0.04}
          />
        ))}

        {/* Pit stop shaded bands */}
        {pitBands.map((b, i) => (
          <rect
            key={i}
            x={LABEL_W + b.x}
            y={0}
            width={b.width}
            height={totalH}
            fill="#eab308"
            opacity={0.08}
          />
        ))}

        {/* Flag event vertical lines */}
        {flagEvents.map((ev, i) => (
          <line
            key={i}
            x1={LABEL_W + ev.x}
            y1={0}
            x2={LABEL_W + ev.x}
            y2={totalH}
            stroke={ev.color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        ))}

        {/* Lap grid lines */}
        {lapTicks.map(({ x, lap }) => (
          <g key={lap}>
            <line
              x1={LABEL_W + x}
              y1={0}
              x2={LABEL_W + x}
              y2={totalH}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
            <text
              x={LABEL_W + x + 2}
              y={10}
              fontSize={8}
              fill="rgba(255,255,255,0.2)"
              fontFamily="var(--mono)"
            >L{lap}</text>
          </g>
        ))}

        {/* Per-channel rows */}
        {CHANNELS.map((ch, rowIdx) => {
          const y0 = rowIdx * ROW_H;
          const pts = buildPolylinePoints(sampledData, ch.key, minTime, maxTime, chartW, ROW_H - 4, ch.max);
          return (
            <g key={ch.key}>
              {/* Row background */}
              <rect
                x={0}
                y={y0}
                width={width}
                height={ROW_H}
                fill={rowIdx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'}
              />
              {/* Row separator */}
              <line x1={0} y1={y0 + ROW_H - 1} x2={width} y2={y0 + ROW_H - 1} stroke="rgba(255,255,255,0.05)" />
              {/* Label area */}
              <text x={6} y={y0 + 14} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="var(--font)" fontWeight={700}>
                {ch.label.toUpperCase()}
              </text>
              {/* Current value */}
              {(() => {
                const pt = bisectRight(
                  sampledData.map(d => ({ t: parseDate(d.date), v: d[ch.key] as number })),
                  currentTime
                );
                if (!pt) return null;
                return (
                  <text x={6} y={y0 + 27} fontSize={10} fill={ch.color} fontFamily="var(--mono)" fontWeight={600}>
                    {ch.key === 'rpm' ? pt.v.toLocaleString() : pt.v}{ch.unit}
                  </text>
                );
              })()}

              {/* Gradient fill under line */}
              <defs>
                <linearGradient id={`grad-${ch.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ch.color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={ch.color} stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {pts && (
                <g clipPath={`url(#clip-${ch.key})`} transform={`translate(${LABEL_W}, ${y0 + 2})`}>
                  {/* Fill polygon */}
                  {pts && (
                    <polygon
                      points={`${pts} ${chartW},${ROW_H - 4} 0,${ROW_H - 4}`}
                      fill={`url(#grad-${ch.key})`}
                    />
                  )}
                  {/* Line */}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={ch.color}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Playhead */}
        <g>
          <line
            x1={LABEL_W + playheadX}
            y1={0}
            x2={LABEL_W + playheadX}
            y2={totalH}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1.5}
          />
          <circle
            cx={LABEL_W + playheadX}
            cy={4}
            r={5}
            fill="white"
          />
        </g>
      </svg>
    </div>
  );
});

// ── Multi-driver chart panel ──────────────────────────────

interface ChartPanelProps {
  drivers: OF1Driver[];
  carDataMap: Map<number, OF1CarData[]>;
  laps: OF1Lap[];
  stintIdx: Map<number, OF1Stint[]>;
  raceControl: OF1RaceControl[];
  currentTime: number;
  minTime: number;
  maxTime: number;
  highlighted: number | null;
  onScrub: (t: number) => void;
  onSelectDriver: (n: number | null) => void;
}

function ChartPanel({
  drivers,
  carDataMap,
  laps,
  stintIdx,
  raceControl,
  currentTime,
  minTime,
  maxTime,
  highlighted,
  onScrub,
  onSelectDriver,
}: ChartPanelProps) {
  // Show highlighted driver first, then others if nothing selected show top 3
  const displayDrivers = useMemo(() => {
    if (highlighted !== null) {
      const d = drivers.find(d => d.driver_number === highlighted);
      return d ? [d] : [];
    }
    return drivers.slice(0, 5);
  }, [drivers, highlighted]);

  if (!drivers.length) {
    return (
      <div className="tchart-empty">
        <span>Select a session to view telemetry</span>
      </div>
    );
  }

  return (
    <div className="tchart-panel">
      {/* Driver selector chips */}
      <div className="tchart-driver-chips">
        {drivers.map(d => (
          <button
            key={d.driver_number}
            className={`tchart-chip${highlighted === d.driver_number ? ' active' : ''}`}
            style={{ borderColor: `#${d.team_colour}`, color: highlighted === d.driver_number ? `#${d.team_colour}` : undefined }}
            onClick={() => onSelectDriver(highlighted === d.driver_number ? null : d.driver_number)}
          >
            {d.name_acronym}
          </button>
        ))}
      </div>

      {/* Charts area */}
      <div className="tchart-charts-scroll">
        {displayDrivers.map(d => (
          <TelemetryChart
            key={d.driver_number}
            driverNumber={d.driver_number}
            driverAbbr={d.name_acronym}
            teamColour={d.team_colour}
            carData={carDataMap.get(d.driver_number) ?? []}
            laps={laps.filter(l => l.driver_number === d.driver_number)}
            stints={stintIdx.get(d.driver_number) ?? []}
            raceControl={raceControl}
            currentTime={currentTime}
            minTime={minTime}
            maxTime={maxTime}
            onScrub={onScrub}
          />
        ))}
        {displayDrivers.length === 0 && (
          <div className="tchart-empty">No driver selected</div>
        )}
      </div>

      {/* Race control messages */}
      <RaceMessages messages={raceControl} currentTime={currentTime} />
    </div>
  );
}

// ── Main RaceReplay ───────────────────────────────────────

interface Props {
  highlightedDriver: number | null;
  onSelectDriver: (n: number | null) => void;
  initialSessionKey?: number;
  onBack?: () => void;
}

export function RaceReplay({ highlightedDriver, onSelectDriver, initialSessionKey, onBack }: Props) {
  const [year, setYear] = useState(2024);
  const [allSessions, setAllSessions] = useState<OF1Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [selectedSession, setSelectedSession] = useState<OF1Session | null>(null);
  const [appliedInitialKey, setAppliedInitialKey] = useState<number | null>(null);

  const [drivers, setDrivers] = useState<OF1Driver[]>([]);
  const [laps, setLaps] = useState<OF1Lap[]>([]);
  const [carDataMap, setCarDataMap] = useState<Map<number, OF1CarData[]>>(new Map());
  const [loadingCarData, setLoadingCarData] = useState(false);
  const [raceControl, setRaceControl] = useState<OF1RaceControl[]>([]);
  const [stints, setStints] = useState<OF1Stint[]>([]);
  const [pits, setPits] = useState<OF1Pit[]>([]);
  const [intervals, setIntervals] = useState<OF1Interval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replay state
  const [rs, setRs] = useState<ReplayState>({ currentTime: 0, playing: false, speed: 4 });
  const rafRef = useRef<number | null>(null);
  const lastRealTime = useRef<number>(0);

  // Derived timeline — use laps to avoid needing location data just for the scrubber
  const { minTime, maxTime } = useMemo(() => {
    const starts = laps.filter(l => l.date_start).map(l => parseDate(l.date_start));
    const ends   = laps.filter(l => l.date_start && l.lap_duration)
      .map(l => parseDate(l.date_start) + (l.lap_duration ?? 0) * 1000);
    const all = [...starts, ...ends];
    if (!all.length) return { minTime: 0, maxTime: 0 };
    return { minTime: Math.min(...all), maxTime: Math.max(...all) };
  }, [laps]);

  // Load sessions
  useEffect(() => {
    const ac = new AbortController();
    setLoadingSessions(true);
    OF1.sessions({ year }, ac.signal)
      .then(setAllSessions)
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
    return () => ac.abort();
  }, [year]);

  // Auto-select session from initialSessionKey (launched from history dashboard)
  useEffect(() => {
    if (!initialSessionKey || initialSessionKey === appliedInitialKey) return;
    // Always fetch the session directly by key — this is the most reliable path.
    // (Checking allSessions first was an optimisation that caused an AbortController
    // race condition: whenever allSessions changed the effect re-ran and cancelled
    // the in-progress fetch before it could complete.)
    const existingMatch = allSessions.find(s => s.session_key === initialSessionKey);
    if (existingMatch) {
      setSelectedSession(existingMatch);
      setAppliedInitialKey(initialSessionKey);
      return;
    }
    const ac = new AbortController();
    OF1.sessions({ session_key: initialSessionKey }, ac.signal)
      .then(sessions => {
        if (sessions.length > 0 && !ac.signal.aborted) {
          setSelectedSession(sessions[0]);
          setAppliedInitialKey(initialSessionKey);
          // Also update allSessions so the picker shows it
          setAllSessions(prev => {
            if (prev.some(s => s.session_key === sessions[0].session_key)) return prev;
            return [...prev, sessions[0]];
          });
        }
      })
      .catch(() => {});
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionKey, appliedInitialKey]);

  // Load session data
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
    // Initialise to session start so the timing tower is never gated by t===0
    setRs({ currentTime: parseDate(selectedSession.date_start), playing: false, speed: 4 });

    Promise.allSettled([
      OF1.drivers({ session_key: sk }, ac.signal),
      OF1.laps({ session_key: sk }, ac.signal),
      OF1.raceControl({ session_key: sk }, ac.signal),
      OF1.stints({ session_key: sk }, ac.signal),
      OF1.pits({ session_key: sk }, ac.signal),
      OF1.intervals({ session_key: sk }, ac.signal),
    ])
      .then(([drvs, lapData, rc, stintsRes, pitsRes, intervalsRes]) => {
        if (ac.signal.aborted) return;
        if (drvs.status === 'fulfilled') setDrivers(drvs.value);
        if (lapData.status === 'fulfilled') {
          setLaps(lapData.value);
          // Refine start time from first lap (falls back to session.date_start set above)
          const starts = lapData.value.filter(l => l.date_start).map(l => parseDate(l.date_start));
          if (starts.length) {
            setRs(prev => ({ ...prev, currentTime: Math.min(...starts) }));
          }
        }
        if (rc.status === 'fulfilled') setRaceControl(rc.value);
        if (stintsRes.status === 'fulfilled') setStints(stintsRes.value);
        if (pitsRes.status === 'fulfilled') setPits(pitsRes.value);
        if (intervalsRes.status === 'fulfilled') setIntervals(intervalsRes.value);
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });

    return () => ac.abort();
  }, [selectedSession]);

  // Load car telemetry data for a driver (on demand or when highlighted changes)
  const loadedDriversRef = useRef<Set<number>>(new Set());

  // Reset loaded tracking when session changes
  useEffect(() => {
    loadedDriversRef.current = new Set();
  }, [selectedSession]);

  // Auto-load car data for highlighted driver (and first 3 drivers on session load)
  useEffect(() => {
    if (!selectedSession || loading) return;
    const sk = selectedSession.session_key;
    const driversToLoad = highlightedDriver !== null
      ? [highlightedDriver]
      : drivers.slice(0, 3).map(d => d.driver_number);

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
              // Sort by date ascending
              const sorted = [...data].sort((a, b) => parseDate(a.date) - parseDate(b.date));
              next.set(dn, sorted);
              return next;
            });
          }
        } catch {
          // skip on error
        }
        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 200));
      }
      if (!ac.signal.aborted) setLoadingCarData(false);
    })();

    return () => { ac.abort(); setLoadingCarData(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedDriver, drivers.length, loading, selectedSession]);

  // Playback loop
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

  // Car data at current time for highlighted driver (for right panel instant value)
  const highlightedCarData = useMemo((): OF1CarData | null => {
    if (highlightedDriver === null) return null;
    const dData = carDataMap.get(highlightedDriver) ?? [];
    const t = rs.currentTime;
    // dData is sorted ascending by date
    let lo = 0, hi = dData.length - 1, result: OF1CarData | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (parseDate(dData[mid].date) <= t) { result = dData[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  }, [highlightedDriver, carDataMap, rs.currentTime]);

  // ── Timing-tower indices (built once, queried via binary search every frame) ──

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

  // Compute live timing tower rows at current replay time
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
        s1,
        s2,
        s3,
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

  const years = [2023, 2024];

  return (
    <div className="replay-root">
      {/* Top bar: back button (when embedded) or year + session selector */}
      <div className="replay-topbar">
        <div className="replay-topbar-left">
          {onBack ? (
            <button className="replay-back-btn" onClick={onBack}>
              <svg viewBox="0 0 14 14" fill="currentColor" width={12} height={12}>
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
              Deselect
            </button>
          ) : (
            <>
              <div className="replay-year-tabs">
                {years.map(y => (
                  <button
                    key={y}
                    className={`replay-year-btn${year === y ? ' active' : ''}`}
                    onClick={() => setYear(y)}
                  >
                    {y}
                  </button>
                ))}
              </div>
              <SessionPickerBar
                selected={selectedSession}
                onSelect={s => setSelectedSession(s)}
                sessions={allSessions}
                loading={loadingSessions}
              />
            </>
          )}
        </div>

        {selectedSession && (
          <div className="replay-session-info">
            <span className="replay-session-name">{selectedSession.circuit_short_name}</span>
            <span className="replay-session-type">{selectedSession.session_name}</span>
          </div>
        )}
      </div>

      {/* Main canvas */}
      {loading && (
        <div className="replay-loading">
          <span className="spinner" />
          Loading session data…
        </div>
      )}
      {error && <div className="replay-error">{error}</div>}

      {!loading && !error && !selectedSession && (
        <div className="replay-empty">
          Select a session above to start the race replay.
        </div>
      )}

      {!loading && !error && selectedSession && (
        <div className="replay-canvas">
          {/* Timing tower — left side */}
          <ReplayTimingTower
            rows={towerRows}
            highlighted={highlightedDriver}
            onSelectDriver={onSelectDriver}
            totalLaps={totalLaps}
          />

          {/* Telemetry chart panel — centre / main area */}
          <ChartPanel
            drivers={drivers}
            carDataMap={carDataMap}
            laps={laps}
            stintIdx={stintIdx}
            raceControl={raceControl}
            currentTime={rs.currentTime}
            minTime={minTime}
            maxTime={maxTime}
            highlighted={highlightedDriver}
            onScrub={t => setRs(p => ({ ...p, currentTime: t, playing: false }))}
            onSelectDriver={onSelectDriver}
          />

          {/* Driver detail panel — right side (shown when driver selected) */}
          {highlightedDriver !== null && (() => {
            const drv = drivers.find(d => d.driver_number === highlightedDriver);
            const driverStints = stintIdx.get(highlightedDriver) ?? [];
            const currentHighlightedLap = towerRows.find(r => r.driverNumber === highlightedDriver)?.currentLap ?? 0;
            const usedStints = driverStints.filter(s => s.lap_start <= (currentHighlightedLap || Infinity));
            const highlightedLaps = laps
              .filter(l => l.driver_number === highlightedDriver && l.date_start && parseDate(l.date_start) <= rs.currentTime)
              .sort((a, b) => a.lap_number - b.lap_number);
            return (
              <div className="replay-telem-col">
                <div className="replay-telem-header" style={{ borderLeftColor: drv ? `#${drv.team_colour}` : undefined }}>
                  <span className="replay-telem-num" style={{ color: drv ? `#${drv.team_colour}` : undefined }}>
                    {drv?.name_acronym ?? highlightedDriver}
                  </span>
                  <span className="replay-telem-abbr">{drv?.team_name ?? ''}</span>
                  <button className="replay-telem-close" onClick={() => onSelectDriver(null)}>×</button>
                </div>

                {/* Live values at playhead */}
                {highlightedCarData && (
                  <div className="replay-telem-body">
                    {/* Speed */}
                    <div className="replay-live-row">
                      <span className="replay-gear-label">Speed</span>
                      <div className="replay-rpm-bar-track">
                        <div className="replay-rpm-bar-fill" style={{ width: `${(highlightedCarData.speed / 360) * 100}%`, background: '#3b82f6' }} />
                      </div>
                      <span className="telem-mini-val" style={{ color: '#3b82f6' }}>{highlightedCarData.speed} km/h</span>
                    </div>
                    {/* Throttle */}
                    <div className="replay-live-row">
                      <span className="replay-gear-label">Throttle</span>
                      <div className="replay-rpm-bar-track">
                        <div className="replay-rpm-bar-fill" style={{ width: `${highlightedCarData.throttle}%`, background: '#22c55e' }} />
                      </div>
                      <span className="telem-mini-val" style={{ color: '#22c55e' }}>{highlightedCarData.throttle}%</span>
                    </div>
                    {/* Brake */}
                    <div className="replay-live-row">
                      <span className="replay-gear-label">Brake</span>
                      <div className="replay-rpm-bar-track">
                        <div className="replay-rpm-bar-fill" style={{ width: `${highlightedCarData.brake}%`, background: '#ef4444' }} />
                      </div>
                      <span className="telem-mini-val" style={{ color: '#ef4444' }}>{highlightedCarData.brake}%</span>
                    </div>
                    {/* RPM */}
                    <div className="replay-live-row">
                      <span className="replay-gear-label">RPM</span>
                      <div className="replay-rpm-bar-track">
                        <div className="replay-rpm-bar-fill" style={{ width: `${((highlightedCarData.rpm ?? 0) / 15000) * 100}%`, background: '#a855f7' }} />
                      </div>
                      <span className="telem-mini-val" style={{ color: '#a855f7' }}>{(highlightedCarData.rpm ?? 0).toLocaleString()}</span>
                    </div>
                    {/* Gear + DRS */}
                    <div className="replay-gear-display">
                      <span className="replay-gear-label">Gear</span>
                      <span className="replay-gear-val">{highlightedCarData.gear}</span>
                      <span className={`replay-drs${highlightedCarData.drs >= 10 ? ' open' : ''}`}>
                        DRS {highlightedCarData.drs >= 10 ? 'OPEN' : 'CLOSED'}
                      </span>
                    </div>
                  </div>
                )}
                {loadingCarData && !highlightedCarData && (
                  <div className="replay-telem-body" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    <span className="spinner" style={{ marginRight: 6 }} />Loading telemetry…
                  </div>
                )}

                {/* Stint history */}
                {usedStints.length > 0 && (
                  <div className="replay-stints">
                    <div className="replay-stints-title">Stints</div>
                    {usedStints.map(s => {
                      const cs = COMPOUND_STYLE[s.compound] ?? null;
                      const lapsOnTyre = currentHighlightedLap >= s.lap_start
                        ? Math.min(currentHighlightedLap, s.lap_end ?? currentHighlightedLap) - s.lap_start + 1
                        : 0;
                      return (
                        <div key={s.stint_number} className="replay-stint-row">
                          <span
                            className="replay-stint-compound"
                            style={cs ? { background: cs.bg, color: cs.fg } : undefined}
                            title={s.compound}
                          >
                            {cs?.abbr ?? s.compound.charAt(0)}
                          </span>
                          <span className="replay-stint-laps">L{s.lap_start}–{s.lap_end ?? '?'}</span>
                          <span className="replay-stint-age">age {s.tyre_age_at_start + lapsOnTyre}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Lap breakdown table */}
                {highlightedLaps.length > 0 && (
                  <div className="replay-lap-table">
                    <div className="replay-lap-table-title">Lap times</div>
                    <table className="replay-lt">
                      <thead>
                        <tr>
                          <th>Lap</th>
                          <th>Time</th>
                          <th>S1</th>
                          <th>S2</th>
                          <th>S3</th>
                        </tr>
                      </thead>
                      <tbody>
                        {highlightedLaps.map(l => (
                          <tr key={l.lap_number}>
                            <td>{l.lap_number}</td>
                            <td className="mono">{fmtLap(l.lap_duration)}</td>
                            <td className="mono">{l.duration_sector_1?.toFixed(3) ?? '—'}</td>
                            <td className="mono">{l.duration_sector_2?.toFixed(3) ?? '—'}</td>
                            <td className="mono">{l.duration_sector_3?.toFixed(3) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Playback controls — always at bottom when session loaded */}
      {selectedSession && !loading && (
        <ReplayControls
          rs={rs}
          minTime={minTime}
          maxTime={maxTime}
          onPlay={() => setRs(p => ({ ...p, playing: true }))}
          onPause={() => setRs(p => ({ ...p, playing: false }))}
          onScrub={t => setRs(p => ({ ...p, currentTime: t, playing: false }))}
          onSpeed={s => setRs(p => ({ ...p, speed: s }))}
        />
      )}
    </div>
  );
}
