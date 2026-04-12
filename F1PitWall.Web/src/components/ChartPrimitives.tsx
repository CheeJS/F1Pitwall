import { useState, useRef } from 'react';

// ── Shared types ──────────────────────────────────────────

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  points: { x: number; y: number }[];
  area?: boolean; // fill area below line
}

export interface BarItem {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  color: string;
}

export interface GanttSegment {
  start: number;
  end: number;
  color: string;       // text color
  bg: string;          // fill color
  label: string;
}

export interface GanttRow {
  id: string;
  label: string;
  sublabel?: string;
  segments: GanttSegment[];
}

// ── Helpers ───────────────────────────────────────────────

export function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const stride = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % stride === 0);
}

function niceRange(min: number, max: number, ticks: number): { min: number; max: number; step: number } {
  const rawStep = (max - min) / ticks;
  if (rawStep === 0) return { min, max: max + 1, step: 1 };
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep / magnitude) * magnitude;
  return {
    min: Math.floor(min / niceStep) * niceStep,
    max: Math.ceil(max / niceStep) * niceStep,
    step: niceStep,
  };
}

// Binary search: find nearest index in sorted xs array
function nearestIdx(xs: number[], target: number): number {
  let lo = 0, hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < target) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - target) < Math.abs(xs[lo] - target)) return lo - 1;
  return lo;
}

// ── LineChart ─────────────────────────────────────────────

interface LineChartProps {
  series: ChartSeries[];
  title?: string;
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  yLabel?: string;
  yMin?: number;
  yMax?: number;
  height?: number;
  invertY?: boolean;
  /** How many pixels wide the y-axis label column is */
  yAxisW?: number;
}

export function LineChart({
  series,
  title,
  xFmt,
  yFmt,
  yLabel,
  yMin: yMinProp,
  yMax: yMaxProp,
  height = 220,
  invertY = false,
  yAxisW = 54,
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null); // SVG-space X

  const W = 900, H = height;
  const pad = { top: 22, right: 18, bottom: 36, left: yAxisW };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const allPts = series.flatMap(s => s.points);
  if (!allPts.length) return (
    <div className="chart-panel">
      {title && <div className="chart-panel-title">{title}</div>}
      <div className="chart-no-data">No data</div>
    </div>
  );

  const allX = allPts.map(p => p.x);
  const allY = allPts.map(p => p.y);
  const xMin = Math.min(...allX), xMax = Math.max(...allX);

  const rawYMin = yMinProp ?? Math.min(...allY);
  const rawYMax = yMaxProp ?? Math.max(...allY);
  const { min: yMin, max: yMax, step: yStep } = niceRange(rawYMin, rawYMax, 5);

  const px = (x: number) => pad.left + ((x - xMin) / (xMax - xMin || 1)) * iW;
  const py = (y: number) => {
    const frac = (y - yMin) / (yMax - yMin || 1);
    return invertY ? pad.top + frac * iH : pad.top + (1 - frac) * iH;
  };

  // Y grid ticks
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + yStep * 0.01; v += yStep) yTicks.push(v);

  // X grid ticks (6–8 evenly spaced)
  const xTickCount = 7;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => xMin + ((xMax - xMin) / (xTickCount - 1)) * i);

  const buildD = (pts: { x: number; y: number }[]) => {
    if (!pts.length) return '';
    const sorted = downsample([...pts].sort((a, b) => a.x - b.x), 800);
    return sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join('');
  };

  const buildArea = (pts: { x: number; y: number }[], baseline: number) => {
    if (!pts.length) return '';
    const sorted = downsample([...pts].sort((a, b) => a.x - b.x), 800);
    const line = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join('');
    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    const base = py(baseline);
    return `${line} L${px(last.x).toFixed(1)},${base} L${px(first.x).toFixed(1)},${base} Z`;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    if (mx < pad.left || mx > W - pad.right) { setHoverX(null); return; }
    setHoverX(mx);
  };

  // For tooltip: find nearest data point per series at hoverX data value
  const hoverXVal = hoverX !== null ? xMin + ((hoverX - pad.left) / iW) * (xMax - xMin) : null;

  const tooltipItems = hoverXVal !== null ? series.map(s => {
    if (!s.points.length) return null;
    const sorted = [...s.points].sort((a, b) => a.x - b.x);
    const xs = sorted.map(p => p.x);
    const i = nearestIdx(xs, hoverXVal);
    return { name: s.name, color: s.color, y: sorted[i].y };
  }).filter(Boolean) as { name: string; color: string; y: number }[] : [];

  // Tooltip left position as % of chart width
  const tooltipLeftPct = hoverX !== null ? (hoverX / W) * 100 : 50;
  const flipToLeft = tooltipLeftPct > 65;

  return (
    <div className="chart-panel">
      {title && <div className="chart-panel-title">{title}</div>}
      <div
        className="chart-wrap"
        onMouseLeave={() => setHoverX(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          onMouseMove={handleMouseMove}
        >
          <defs>
            {series.filter(s => s.area).map(s => (
              <linearGradient key={s.id} id={`ag-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          {/* Y grid */}
          {yTicks.map((yv, i) => (
            <g key={i}>
              <line
                x1={pad.left} y1={py(yv)}
                x2={W - pad.right} y2={py(yv)}
                stroke="var(--border)" strokeWidth="0.5"
              />
              <text
                x={pad.left - 5} y={py(yv)}
                textAnchor="end" dominantBaseline="central"
                fontSize="9" fill="var(--text-muted)" fontFamily="var(--mono)"
              >
                {yFmt ? yFmt(yv) : yv % 1 === 0 ? yv.toFixed(0) : yv.toFixed(1)}
              </text>
            </g>
          ))}

          {/* X grid */}
          {xTicks.map((xv, i) => (
            <g key={i}>
              <line
                x1={px(xv)} y1={pad.top}
                x2={px(xv)} y2={H - pad.bottom}
                stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3"
              />
              <text
                x={px(xv)} y={H - pad.bottom + 13}
                textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--mono)"
              >
                {xFmt ? xFmt(xv) : xv.toFixed(0)}
              </text>
            </g>
          ))}

          {/* Axes */}
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={H - pad.bottom} stroke="var(--border-strong)" strokeWidth="1" />
          <line x1={pad.left} y1={H - pad.bottom} x2={W - pad.right} y2={H - pad.bottom} stroke="var(--border-strong)" strokeWidth="1" />

          {/* Y label */}
          {yLabel && (
            <text
              x={10} y={pad.top + iH / 2}
              textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font)"
              transform={`rotate(-90, 10, ${pad.top + iH / 2})`}
            >
              {yLabel}
            </text>
          )}

          {/* Area fills */}
          {series.filter(s => s.area).map(s => (
            <path
              key={`a-${s.id}`}
              d={buildArea(s.points, yMin)}
              fill={`url(#ag-${s.id})`}
              stroke="none"
            />
          ))}

          {/* Lines */}
          {series.map(s => (
            <path
              key={s.id}
              d={buildD(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Crosshair */}
          {hoverX !== null && (
            <line
              x1={hoverX} y1={pad.top}
              x2={hoverX} y2={H - pad.bottom}
              stroke="var(--text-muted)" strokeWidth="0.75" strokeDasharray="4 2"
            />
          )}
        </svg>

        {/* Tooltip */}
        {hoverX !== null && tooltipItems.length > 0 && (
          <div
            className="chart-tooltip"
            style={{
              left: flipToLeft ? undefined : `calc(${tooltipLeftPct}% + 6px)`,
              right: flipToLeft ? `calc(${100 - tooltipLeftPct}% + 6px)` : undefined,
            }}
          >
            {hoverXVal !== null && (
              <div className="chart-tooltip-x">{xFmt ? xFmt(hoverXVal) : hoverXVal.toFixed(2)}</div>
            )}
            {tooltipItems.map((item, i) => (
              <div key={i} className="chart-tooltip-row">
                <span className="chart-tooltip-dot" style={{ background: item.color }} />
                <span className="chart-tooltip-name">{item.name}</span>
                <span className="chart-tooltip-val">{yFmt ? yFmt(item.y) : item.y.toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  if (!series.length) return null;
  return (
    <div className="chart-legend">
      {series.map(s => (
        <span key={s.id} className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

// ── HBarChart ─────────────────────────────────────────────

interface HBarChartProps {
  items: BarItem[];
  title?: string;
  xFmt?: (v: number) => string;
  xLabel?: string;
  maxItems?: number;
}

export function HBarChart({ items, title, xFmt, xLabel, maxItems = 40 }: HBarChartProps) {
  const visible = items.slice(0, maxItems);
  if (!visible.length) return <div className="chart-no-data">No data</div>;

  const maxVal = Math.max(...visible.map(i => i.value), 1);
  const ROW_H = 28;
  const GAP = 4;
  const labelW = 110;
  const valW = 60;
  const W = 900;
  const barW = W - labelW - valW - 20;
  const H = visible.length * (ROW_H + GAP) + 44;

  return (
    <div className="chart-panel">
      {title && <div className="chart-panel-title">{title}</div>}
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
          {/* X grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const x = labelW + f * barW;
            const v = maxVal * f;
            return (
              <g key={f}>
                <line x1={x} y1={8} x2={x} y2={H - 28} stroke="var(--border)" strokeWidth="0.5" />
                <text x={x} y={H - 12} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--mono)">
                  {xFmt ? xFmt(v) : v.toFixed(0)}
                </text>
              </g>
            );
          })}

          {visible.map((item, i) => {
            const y = i * (ROW_H + GAP) + 16;
            const bw = Math.max(0, (item.value / maxVal) * barW);
            return (
              <g key={item.id}>
                {/* Label */}
                <text x={labelW - 8} y={y + ROW_H / 2} textAnchor="end" dominantBaseline="central" fontSize="11" fill="var(--text-secondary)" fontFamily="var(--font)">
                  {item.label}
                </text>
                {item.sublabel && (
                  <text x={labelW - 8} y={y + ROW_H / 2 + 11} textAnchor="end" fontSize="9" fill="var(--text-muted)" fontFamily="var(--mono)">
                    {item.sublabel}
                  </text>
                )}
                {/* Track */}
                <rect x={labelW} y={y + 4} width={barW} height={ROW_H - 8} rx={2} fill="var(--bg-raised)" />
                {/* Bar */}
                <rect x={labelW} y={y + 4} width={bw} height={ROW_H - 8} rx={2} fill={item.color} opacity={0.85} />
                {/* Value */}
                <text x={labelW + barW + 8} y={y + ROW_H / 2} dominantBaseline="central" fontSize="11" fill="var(--text-secondary)" fontFamily="var(--mono)">
                  {xFmt ? xFmt(item.value) : item.value.toLocaleString()}
                </text>
              </g>
            );
          })}

          {xLabel && (
            <text x={labelW + barW / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font)">
              {xLabel}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}

// ── GanttChart ────────────────────────────────────────────

interface GanttChartProps {
  rows: GanttRow[];
  title?: string;
  xLabel?: string;
}

export function GanttChart({ rows, title, xLabel }: GanttChartProps) {
  if (!rows.length) return <div className="chart-no-data">No data</div>;

  const allStarts = rows.flatMap(r => r.segments.map(s => s.start));
  const allEnds = rows.flatMap(r => r.segments.map(s => s.end));
  const xMin = Math.min(...allStarts, 0);
  const xMax = Math.max(...allEnds, 1);

  const ROW_H = 26;
  const GAP = 5;
  const labelW = 56;
  const W = 900;
  const chartW = W - labelW - 20;
  const H = rows.length * (ROW_H + GAP) + 40;

  const px = (x: number) => labelW + ((x - xMin) / (xMax - xMin || 1)) * chartW;

  // X ticks at nice intervals
  const range = xMax - xMin;
  const step = range <= 30 ? 5 : range <= 60 ? 10 : range <= 120 ? 20 : 25;
  const xTicks: number[] = [];
  for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) xTicks.push(v);

  return (
    <div className="chart-panel">
      {title && <div className="chart-panel-title">{title}</div>}
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
          {/* X grid */}
          {xTicks.map(t => (
            <g key={t}>
              <line x1={px(t)} y1={0} x2={px(t)} y2={H - 28} stroke="var(--border)" strokeWidth="0.5" />
              <text x={px(t)} y={H - 12} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--mono)">{t}</text>
            </g>
          ))}

          {rows.map((row, i) => {
            const y = i * (ROW_H + GAP) + 8;
            return (
              <g key={row.id}>
                <text x={labelW - 6} y={y + ROW_H / 2} textAnchor="end" dominantBaseline="central" fontSize="10" fontWeight="600" fill="var(--text-secondary)" fontFamily="var(--font)">
                  {row.label}
                </text>
                {row.sublabel && (
                  <text x={labelW - 6} y={y + ROW_H / 2 + 10} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontFamily="var(--mono)">
                    {row.sublabel}
                  </text>
                )}
                {/* Row track */}
                <rect x={labelW} y={y + 2} width={chartW} height={ROW_H - 4} rx={2} fill="var(--bg-raised)" opacity="0.4" />
                {row.segments.map((seg, j) => {
                  const x1 = px(seg.start);
                  const x2 = px(seg.end);
                  const bw = Math.max(2, x2 - x1);
                  return (
                    <g key={j}>
                      <rect x={x1} y={y + 2} width={bw} height={ROW_H - 4} rx={2} fill={seg.bg} />
                      {bw > 22 && (
                        <text
                          x={x1 + bw / 2} y={y + ROW_H / 2}
                          textAnchor="middle" dominantBaseline="central"
                          fontSize="8" fontWeight="800" fill={seg.color} fontFamily="var(--font)"
                        >
                          {seg.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {xLabel && (
            <text x={(W + labelW) / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font)">
              {xLabel}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
