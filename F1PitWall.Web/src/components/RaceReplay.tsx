import {
  useState, useEffect, useRef, useMemo, memo
} from 'react';
import type { OF1Driver, OF1CarData, OF1Lap, OF1RaceControl, OF1Stint } from '../api/openf1Direct';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { TrackMap } from './TrackMap';
import {
  type ReplayState, type TowerRow, SPEED_OPTIONS, COMPOUND_STYLE,
  parseDate, formatDuration, fmtLap, fmtGap, fmtInterval, bisectRight,
} from '../utils/replayUtils';

// ── Timing Tower ─────────────────────────────────────────

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
      <span className="replay-tower-col-laptime">
        {fmtLap(row.lastLapTime)}
      </span>
    </div>
  );
});

export function ReplayTimingTower({ rows, highlighted, onSelectDriver, totalLaps }: TowerProps) {
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

// ── Replay Controls ──────────────────────────────────────

interface ControlsProps {
  rs: ReplayState;
  minTime: number;
  maxTime: number;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (t: number) => void;
  onSpeed: (s: number) => void;
}

export function ReplayControls({ rs, minTime, maxTime, onPlay, onPause, onScrub, onSpeed }: ControlsProps) {
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

// ── Race control messages ────────────────────────────────

interface MsgProps { messages: OF1RaceControl[]; currentTime: number; }

export function RaceMessages({ messages, currentTime }: MsgProps) {
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

// ── Continuous Telemetry Chart ───────────────────────────

// ── Vital-signs rolling telemetry chart ──────────────────
// Shows a rolling window (default 60s) around the current time,
// like a hospital heart rate monitor — data scrolls left, current
// value glows on the right edge.

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

const WINDOW_SECS = 60; // rolling window width in seconds

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
  currentTime,
  minTime,
  maxTime,
  onScrub,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const ROW_H = 72;
  const LABEL_W = 60;
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

  // Rolling window: show WINDOW_SECS of data ending at currentTime
  const windowMs = WINDOW_SECS * 1000;
  const winEnd = currentTime;
  const winStart = currentTime - windowMs;

  // Filter car data to the visible window (with small margin)
  const windowData = useMemo(() => {
    if (!carData.length) return [];
    const margin = 2000; // 2s margin for smooth edges
    return carData.filter(d => {
      const t = parseDate(d.date);
      return t >= winStart - margin && t <= winEnd + margin;
    });
  }, [carData, winStart, winEnd]);

  // Build polyline points within the rolling window
  function buildWindowPts(key: ChartChannel['key'], h: number, maxVal: number): { pts: string; lastX: number; lastY: number } | null {
    if (!windowData.length || windowMs <= 0) return null;
    const pts: string[] = [];
    let lastX = 0, lastY = h;
    for (const cd of windowData) {
      const t = parseDate(cd.date);
      const x = ((t - winStart) / windowMs) * chartW;
      const rawVal = cd[key] as number;
      const y = h - (Math.min(rawVal, maxVal) / maxVal) * h;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      lastX = x;
      lastY = y;
    }
    return { pts: pts.join(' '), lastX, lastY };
  }

  // Current values at playhead
  const currentValues = useMemo(() => {
    const vals: Record<string, number> = {};
    if (!carData.length) return vals;
    // Binary search for the latest point <= currentTime
    let lo = 0, hi = carData.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (parseDate(carData[mid].date) <= currentTime) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best >= 0) {
      const d = carData[best];
      for (const ch of CHANNELS) vals[ch.key] = d[ch.key] as number;
    }
    return vals;
  }, [carData, currentTime]);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left - LABEL_W;
    const t = winStart + (relX / chartW) * windowMs;
    onScrub(Math.max(minTime, Math.min(maxTime, t)));
  };

  const totalH = ROW_H * CHANNELS.length;

  return (
    <div className="tchart-wrap" ref={containerRef}>
      <div className="tchart-driver-header" style={{ borderLeftColor: `#${teamColour}` }}>
        <span className="tchart-driver-abbr" style={{ color: `#${teamColour}` }}>{driverAbbr}</span>
        {carData.length === 0 && <span className="tchart-loading-hint">Loading telemetry…</span>}
      </div>

      <svg className="tchart-svg" width={width} height={totalH} onClick={handleClick} style={{ cursor: 'crosshair' }}>
        <defs>
          <clipPath id="clip-chart-area">
            <rect x={LABEL_W} y={0} width={chartW} height={totalH} />
          </clipPath>
          {/* Fade-out gradient on the left edge */}
          <linearGradient id="fade-left" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--bg, #0a0a0f)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--bg, #0a0a0f)" stopOpacity="0" />
          </linearGradient>
          {CHANNELS.map(ch => (
            <linearGradient key={ch.key} id={`grad-${ch.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ch.color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={ch.color} stopOpacity="0" />
            </linearGradient>
          ))}
          {/* Glow filter for the live dot */}
          <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines — every 10 seconds */}
        {Array.from({ length: Math.floor(WINDOW_SECS / 10) + 1 }, (_, i) => {
          const t = Math.ceil(winStart / 10000) * 10000 + i * 10000;
          if (t > winEnd) return null;
          const x = LABEL_W + ((t - winStart) / windowMs) * chartW;
          const secs = Math.floor((t - winStart) / 1000);
          return (
            <g key={i}>
              <line x1={x} y1={0} x2={x} y2={totalH} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
              {secs > 0 && secs < WINDOW_SECS && (
                <text x={x} y={totalH - 3} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.15)" fontFamily="var(--mono)">
                  -{WINDOW_SECS - secs}s
                </text>
              )}
            </g>
          );
        })}

        {/* Per-channel rows */}
        {CHANNELS.map((ch, rowIdx) => {
          const y0 = rowIdx * ROW_H;
          const h = ROW_H - 8;
          const result = buildWindowPts(ch.key, h, ch.max);
          const curVal = currentValues[ch.key];
          const fmtVal = curVal !== undefined
            ? (ch.key === 'rpm' ? curVal.toLocaleString() : String(curVal))
            : '—';

          return (
            <g key={ch.key}>
              {/* Row separator */}
              {rowIdx > 0 && (
                <line x1={0} y1={y0} x2={width} y2={y0} stroke="rgba(255,255,255,0.04)" />
              )}

              {/* Label + current value */}
              <text x={8} y={y0 + 16} fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="var(--font)" fontWeight={700} letterSpacing="0.04em">
                {ch.label.toUpperCase()}
              </text>
              <text x={8} y={y0 + 32} fontSize={14} fill={ch.color} fontFamily="var(--mono)" fontWeight={700}>
                {fmtVal}
              </text>
              <text x={8} y={y0 + 44} fontSize={9} fill="rgba(255,255,255,0.2)" fontFamily="var(--mono)">
                {ch.unit}
              </text>

              {/* Chart area */}
              {result && (
                <g clipPath="url(#clip-chart-area)">
                  {/* Filled area under curve */}
                  <polygon
                    points={`${LABEL_W},${y0 + 4 + h} ${result.pts.split(' ').map(p => {
                      const [px, py] = p.split(',');
                      return `${(parseFloat(px) + LABEL_W).toFixed(1)},${(parseFloat(py) + y0 + 4).toFixed(1)}`;
                    }).join(' ')} ${(result.lastX + LABEL_W).toFixed(1)},${y0 + 4 + h}`}
                    fill={`url(#grad-${ch.key})`}
                  />
                  {/* Main trace line */}
                  <polyline
                    points={result.pts.split(' ').map(p => {
                      const [px, py] = p.split(',');
                      return `${(parseFloat(px) + LABEL_W).toFixed(1)},${(parseFloat(py) + y0 + 4).toFixed(1)}`;
                    }).join(' ')}
                    fill="none"
                    stroke={ch.color}
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Glowing live dot at current value */}
                  <circle
                    cx={result.lastX + LABEL_W}
                    cy={result.lastY + y0 + 4}
                    r={4}
                    fill={ch.color}
                    filter="url(#dot-glow)"
                  />
                  <circle
                    cx={result.lastX + LABEL_W}
                    cy={result.lastY + y0 + 4}
                    r={2}
                    fill="#fff"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Left edge fade */}
        <rect x={LABEL_W} y={0} width={40} height={totalH} fill="url(#fade-left)" pointerEvents="none" />
      </svg>
    </div>
  );
});

// ── Multi-driver chart panel ─────────────────────────────

interface ChartPanelProps {
  drivers: OF1Driver[];
  carDataMap: Map<number, OF1CarData[]>;
  laps: OF1Lap[];
  stintIdx: Map<number, OF1Stint[]>;
  raceControl: OF1RaceControl[];
  currentTime: number;
  minTime: number;
  maxTime: number;
  onScrub: (t: number) => void;
  /** Exposes selected driver numbers to parent */
  comparedDrivers: number[];
  onComparedChange: (drivers: number[]) => void;
}

function ChartPanel({
  drivers, carDataMap, laps, stintIdx, raceControl,
  currentTime, minTime, maxTime, onScrub,
  comparedDrivers, onComparedChange,
}: ChartPanelProps) {
  const toggleDriver = (dn: number) => {
    if (comparedDrivers.includes(dn)) {
      onComparedChange(comparedDrivers.filter(n => n !== dn));
    } else if (comparedDrivers.length >= 2) {
      onComparedChange([comparedDrivers[1], dn]);
    } else {
      onComparedChange([...comparedDrivers, dn]);
    }
  };

  const displayDrivers = useMemo(() => {
    return comparedDrivers
      .map(dn => drivers.find(d => d.driver_number === dn))
      .filter(Boolean) as OF1Driver[];
  }, [drivers, comparedDrivers]);

  if (!drivers.length) {
    return (
      <div className="tchart-empty">
        <span>Select a session to view telemetry</span>
      </div>
    );
  }

  return (
    <div className="tchart-panel">
      <div className="tchart-driver-chips">
        <span className="tchart-chip-hint">Compare (max 2):</span>
        {drivers.map(d => (
          <button
            key={d.driver_number}
            className={`tchart-chip${comparedDrivers.includes(d.driver_number) ? ' active' : ''}`}
            style={{ borderColor: `#${d.team_colour}`, color: comparedDrivers.includes(d.driver_number) ? `#${d.team_colour}` : undefined }}
            onClick={() => toggleDriver(d.driver_number)}
          >
            {d.name_acronym}
          </button>
        ))}
      </div>

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
          <div className="tchart-empty">Select up to 2 drivers above to compare</div>
        )}
      </div>

      <RaceMessages messages={raceControl} currentTime={currentTime} />
    </div>
  );
}

// ── Driver Detail Panel ──────────────────────────────────

export function DriverDetailPanel({
  highlightedDriver, drivers, highlightedCarData, loadingCarData,
  stintIdx, laps, towerRows, rs,
}: {
  highlightedDriver: number | null;
  drivers: OF1Driver[];
  highlightedCarData: OF1CarData | null;
  loadingCarData: boolean;
  stintIdx: Map<number, OF1Stint[]>;
  laps: OF1Lap[];
  towerRows: TowerRow[];
  rs: ReplayState;
  onSelectDriver: (n: number | null) => void;
}) {
  if (highlightedDriver === null) return null;

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
      </div>

      {highlightedCarData && (
        <div className="replay-telem-body">
          <div className="replay-live-row">
            <span className="replay-gear-label">Speed</span>
            <div className="replay-rpm-bar-track">
              <div className="replay-rpm-bar-fill" style={{ width: `${(highlightedCarData.speed / 360) * 100}%`, background: '#3b82f6' }} />
            </div>
            <span className="telem-mini-val" style={{ color: '#3b82f6' }}>{highlightedCarData.speed} km/h</span>
          </div>
          <div className="replay-live-row">
            <span className="replay-gear-label">Throttle</span>
            <div className="replay-rpm-bar-track">
              <div className="replay-rpm-bar-fill" style={{ width: `${highlightedCarData.throttle}%`, background: '#22c55e' }} />
            </div>
            <span className="telem-mini-val" style={{ color: '#22c55e' }}>{highlightedCarData.throttle}%</span>
          </div>
          <div className="replay-live-row">
            <span className="replay-gear-label">Brake</span>
            <div className="replay-rpm-bar-track">
              <div className="replay-rpm-bar-fill" style={{ width: `${highlightedCarData.brake}%`, background: '#ef4444' }} />
            </div>
            <span className="telem-mini-val" style={{ color: '#ef4444' }}>{highlightedCarData.brake}%</span>
          </div>
          <div className="replay-live-row">
            <span className="replay-gear-label">RPM</span>
            <div className="replay-rpm-bar-track">
              <div className="replay-rpm-bar-fill" style={{ width: `${((highlightedCarData.rpm ?? 0) / 15000) * 100}%`, background: '#a855f7' }} />
            </div>
            <span className="telem-mini-val" style={{ color: '#a855f7' }}>{(highlightedCarData.rpm ?? 0).toLocaleString()}</span>
          </div>
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
                <span className="replay-stint-compound" style={cs ? { background: cs.bg, color: cs.fg } : undefined} title={s.compound}>
                  {cs?.abbr ?? s.compound.charAt(0)}
                </span>
                <span className="replay-stint-laps">L{s.lap_start}–{s.lap_end ?? '?'}</span>
                <span className="replay-stint-age">age {s.tyre_age_at_start + lapsOnTyre}</span>
              </div>
            );
          })}
        </div>
      )}

      {highlightedLaps.length > 0 && (
        <div className="replay-lap-table">
          <div className="replay-lap-table-title">Lap times</div>
          <table className="replay-lt">
            <thead>
              <tr><th>Lap</th><th>Time</th><th>S1</th><th>S2</th><th>S3</th></tr>
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
}

// ── Main RaceReplay (inline history tab) ─────────────────

interface Props {
  highlightedDriver: number | null;
  onSelectDriver: (n: number | null) => void;
  initialSessionKey?: number;
  /** Pass session info to avoid re-fetching from OpenF1 */
  sessionInfo?: import('../hooks/useReplayEngine').ReplaySessionInfo | null;
}

export function RaceReplay({ highlightedDriver, onSelectDriver, initialSessionKey, sessionInfo }: Props) {
  const [comparedDrivers, setComparedDrivers] = useState<number[]>([]);

  const engine = useReplayEngine({
    session: sessionInfo,
    sessionKey: initialSessionKey,
    highlightedDriver,
    comparedDrivers,
  });
  const {
    selectedSession, drivers, laps, carDataMap, raceControl, stintIdx,
    loading, loadingCarData, error,
    rs, minTime, maxTime,
    towerRows, totalLaps, highlightedCarData,
    driverMarkers, trackPoints,
    play, pause, scrub, setSpeed,
  } = engine;

  return (
    <div className="replay-root">
      {selectedSession && (
        <div className="replay-topbar">
          <div className="replay-session-info">
            <span className="replay-session-name">{selectedSession.circuit_short_name}</span>
            <span className="replay-session-type">{selectedSession.session_name}</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="replay-loading">
          <span className="spinner" />
          Loading session data…
        </div>
      )}
      {error && <div className="replay-error">{error}</div>}

      {!loading && !error && !selectedSession && (
        <div className="replay-empty">
          Select a session to start the race replay.
        </div>
      )}

      {!loading && !error && selectedSession && (
        <div className="replay-canvas">
          {/* Left: Timing tower */}
          <ReplayTimingTower
            rows={towerRows}
            highlighted={highlightedDriver}
            onSelectDriver={onSelectDriver}
            totalLaps={totalLaps}
          />

          {/* Center: Track map + Telemetry */}
          <div className="replay-center">
            <div className="replay-map-area">
              <TrackMap
                markers={driverMarkers}
                highlighted={highlightedDriver}
                onSelectDriver={onSelectDriver}
                trackPoints={trackPoints ?? undefined}
              />
            </div>
            <ChartPanel
              drivers={drivers}
              carDataMap={carDataMap}
              laps={laps}
              stintIdx={stintIdx}
              raceControl={raceControl}
              currentTime={rs.currentTime}
              minTime={minTime}
              maxTime={maxTime}
              onScrub={scrub}
              comparedDrivers={comparedDrivers}
              onComparedChange={setComparedDrivers}
            />
          </div>

          {/* Right: Driver detail panels for compared drivers */}
          {comparedDrivers.length > 0 && (
            <div className="replay-detail-col">
              {comparedDrivers.map(dn => (
                <DriverDetailPanel
                  key={dn}
                  highlightedDriver={dn}
                  drivers={drivers}
                  highlightedCarData={
                    dn === highlightedDriver ? highlightedCarData : null
                  }
                  loadingCarData={loadingCarData}
                  stintIdx={stintIdx}
                  laps={laps}
                  towerRows={towerRows}
                  rs={rs}
                  onSelectDriver={onSelectDriver}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedSession && !loading && (
        <ReplayControls
          rs={rs}
          minTime={minTime}
          maxTime={maxTime}
          onPlay={play}
          onPause={pause}
          onScrub={scrub}
          onSpeed={setSpeed}
        />
      )}
    </div>
  );
}
