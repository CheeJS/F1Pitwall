/**
 * SpeedTrace — D3 lap telemetry comparison chart.
 *
 * Shows two drivers' telemetry overlaid across a normalized lap (0→100%).
 * Shaded region indicates which driver holds the advantage at each track section.
 * Delta area below shows cumulative time gap through the lap.
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { OF1Driver, OF1CarData, OF1Lap } from '../api/openf1Direct';
import { parseDate } from '../utils/replayUtils';

// ── Types ────────────────────────────────────────────────

type Channel = 'speed' | 'throttle' | 'brake' | 'rpm';

interface ChannelDef {
  key: Channel;
  label: string;
  cssVar: string;
  max: number;
  unit: string;
}

const CHANNELS: ChannelDef[] = [
  { key: 'speed',    label: 'Speed',    cssVar: '--telem-speed',    max: 360,   unit: 'km/h' },
  { key: 'throttle', label: 'Throttle', cssVar: '--telem-throttle', max: 100,   unit: '%'    },
  { key: 'brake',    label: 'Brake',    cssVar: '--telem-brake',    max: 100,   unit: '%'    },
  { key: 'rpm',      label: 'RPM',      cssVar: '--telem-rpm',      max: 15000, unit: 'rpm'  },
];

export interface SpeedTraceProps {
  drivers: OF1Driver[];
  carDataMap: Map<number, OF1CarData[]>;
  laps: OF1Lap[];
  driverNumbers: [number, number];
  currentTime: number;
}

// ── Data helpers ─────────────────────────────────────────

/** Resample a series to `n` evenly-spaced x values over [0, 1] via linear interpolation. */
function resample(pts: { x: number; y: number }[], n = 300): { x: number; y: number }[] {
  if (pts.length < 2) return [];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const tx = i / n;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x <= tx) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[hi];
    const t = b.x === a.x ? 0 : (tx - a.x) / (b.x - a.x);
    out.push({ x: tx, y: a.y + t * (b.y - a.y) });
  }
  return out;
}

/** Extract and normalize car data for a specific lap into x=[0,1] fraction of lap time. */
function extractLapSeries(
  driverNumber: number,
  lapNumber: number,
  laps: OF1Lap[],
  carData: OF1CarData[],
  channel: Channel,
): { x: number; y: number }[] {
  const lap = laps.find(l => l.driver_number === driverNumber && l.lap_number === lapNumber);
  if (!lap?.date_start || !lap.lap_duration) return [];
  const start = parseDate(lap.date_start);
  const dur = lap.lap_duration * 1000;
  const pts = carData
    .filter(d => {
      const t = parseDate(d.date);
      return t >= start - 50 && t <= start + dur + 50;
    })
    .map(d => ({
      x: Math.max(0, Math.min(1, (parseDate(d.date) - start) / dur)),
      y: (d[channel] as number) ?? 0,
    }));
  if (pts.length < 4) return [];
  return resample(pts);
}

/** Compute delta series: positive = driver 0 has higher value at this point. */
function buildDelta(
  s0: { x: number; y: number }[],
  s1: { x: number; y: number }[],
): { x: number; y: number }[] {
  const n = Math.min(s0.length, s1.length);
  return Array.from({ length: n }, (_, i) => ({ x: s0[i].x, y: s0[i].y - s1[i].y }));
}

// ── Component ────────────────────────────────────────────

export function SpeedTrace({ drivers, carDataMap, laps, driverNumbers, currentTime }: SpeedTraceProps) {
  const mainSvgRef  = useRef<SVGSVGElement>(null);
  const deltaSvgRef = useRef<SVGSVGElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);

  const [width, setWidth]       = useState(600);
  const [channel, setChannel]   = useState<Channel>('speed');
  const [lapOffset, setLapOffset] = useState(0); // offset from "current lap"

  // Track resize — RAF-debounced to avoid layout thrash on continuous resize events
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf: number;
    const ro = new ResizeObserver(e => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(Math.floor(e[0].contentRect.width)));
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const [dn0, dn1] = driverNumbers;
  const drv0 = drivers.find(d => d.driver_number === dn0);
  const drv1 = drivers.find(d => d.driver_number === dn1);

  // Resolve the last completed lap for dn0 at the current playhead
  const baseLap = useMemo(() => {
    const dLaps = laps
      .filter(l => l.driver_number === dn0 && l.date_start && l.lap_duration)
      .sort((a, b) => a.lap_number - b.lap_number);
    let last: (typeof dLaps)[0] | null = null;
    for (const l of dLaps) {
      if (parseDate(l.date_start) + (l.lap_duration ?? 0) * 1000 <= currentTime) last = l;
    }
    return last?.lap_number ?? null;
  }, [dn0, laps, currentTime]);

  // Reset offset when base lap changes (moved to a new lap during playback)
  const prevBaseLap = useRef<number | null>(null);
  useEffect(() => {
    if (prevBaseLap.current !== null && prevBaseLap.current !== baseLap) {
      setLapOffset(0);
    }
    prevBaseLap.current = baseLap;
  }, [baseLap]);

  const targetLap = baseLap !== null ? baseLap + lapOffset : null;
  const maxLap = useMemo(() => {
    const ns = laps
      .filter(l => l.driver_number === dn0 && !!l.lap_duration)
      .map(l => l.lap_number);
    return ns.length ? Math.max(...ns) : 0;
  }, [laps, dn0]);

  const cd0 = carDataMap.get(dn0) ?? [];
  const cd1 = carDataMap.get(dn1) ?? [];

  const [s0, s1] = useMemo(() => {
    if (targetLap === null) return [[], []] as [{ x: number; y: number }[], { x: number; y: number }[]];
    return [
      extractLapSeries(dn0, targetLap, laps, cd0, channel),
      extractLapSeries(dn1, targetLap, laps, cd1, channel),
    ];
  }, [dn0, dn1, targetLap, laps, cd0, cd1, channel]);

  const delta = useMemo(() => buildDelta(s0, s1), [s0, s1]);
  const chDef = CHANNELS.find(c => c.key === channel)!;

  const color0 = `#${drv0?.team_colour ?? 'ffffff'}`;
  const color1 = `#${drv1?.team_colour ?? '888888'}`;

  // ── D3 main trace ──────────────────────────────────────
  const drawMain = useCallback(() => {
    const el = mainSvgRef.current;
    if (!el) return;

    // Read colours from CSS tokens so D3 stays in sync with the design system
    const cs = getComputedStyle(el);
    const cGrid   = cs.getPropertyValue('--border').trim() || '#27272a';
    const cMuted  = cs.getPropertyValue('--text-muted').trim() || '#52525b';
    const cText   = cs.getPropertyValue('--text-secondary').trim() || '#a1a1aa';
    const cBg     = cs.getPropertyValue('--bg').trim() || '#09090b';
    const fontUI  = cs.getPropertyValue('--font').trim() || 'Titillium Web, sans-serif';
    const fontMono = cs.getPropertyValue('--mono').trim() || 'JetBrains Mono, monospace';

    const H = 200;
    const M = { top: 12, right: 14, bottom: 22, left: 42 };
    const iW = width - M.left - M.right;
    const iH = H - M.top - M.bottom;

    const svg = d3.select(el).attr('width', width).attr('height', H);
    svg.selectAll('*').remove();

    // Empty state
    if (!s0.length && !s1.length) {
      svg.append('text')
        .attr('x', width / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', cMuted)
        .attr('font-size', 11).attr('font-family', fontUI)
        .text(targetLap === null ? 'Waiting for a completed lap…' : `No telemetry loaded for lap ${targetLap} — select drivers above`);
      return;
    }

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // Clip path
    svg.append('defs').append('clipPath').attr('id', `tc-clip-${dn0}`)
      .append('rect').attr('width', iW).attr('height', iH);

    const x = d3.scaleLinear().domain([0, 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([0, chDef.max]).range([iH, 0]);

    // Horizontal grid lines
    g.selectAll('.gh').data(y.ticks(4)).enter()
      .append('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', d => y(d as number)).attr('y2', d => y(d as number))
      .attr('stroke', cGrid).attr('stroke-width', 1);

    // Advantage shading (shaded region between the two traces)
    const N = Math.min(s0.length, s1.length);
    if (N > 0) {
      interface Seg { i0: number; i1: number; winner: 0 | 1 }
      const segs: Seg[] = [];
      let cur: Seg | null = null;
      for (let i = 0; i < N; i++) {
        const w: 0 | 1 = s0[i].y >= s1[i].y ? 0 : 1;
        if (!cur || cur.winner !== w) {
          if (cur) segs.push(cur);
          cur = { i0: i, i1: i, winner: w };
        }
        cur.i1 = i;
      }
      if (cur) segs.push(cur);

      const advG = g.append('g').attr('clip-path', `url(#tc-clip-${dn0})`);
      for (const seg of segs) {
        const top = seg.winner === 0 ? s0 : s1;
        const bot = seg.winner === 0 ? s1 : s0;
        const slice = (arr: typeof s0) => arr.slice(seg.i0, seg.i1 + 1);
        const topPts = slice(top);
        const botPts = slice(bot);
        if (topPts.length < 2) continue;

        // Build closed polygon
        const polyPts: [number, number][] = [
          ...topPts.map(p => [x(p.x), y(p.y)] as [number, number]),
          ...botPts.slice().reverse().map(p => [x(p.x), y(p.y)] as [number, number]),
        ];
        const pathD = d3.line<[number, number]>(d => d[0], d => d[1]).curve(d3.curveLinear)(polyPts);
        if (pathD) {
          advG.append('path')
            .attr('d', pathD + 'Z')
            .attr('fill', seg.winner === 0 ? color0 : color1)
            .attr('fill-opacity', 0.14)
            .attr('stroke', 'none');
        }
      }
    }

    // Line generator
    const line = d3.line<{ x: number; y: number }>()
      .x(d => x(d.x)).y(d => y(d.y))
      .curve(d3.curveMonotoneX);

    const linesG = g.append('g').attr('clip-path', `url(#tc-clip-${dn0})`);

    // Driver 1 (rendered first, behind)
    if (s1.length) {
      linesG.append('path').datum(s1)
        .attr('fill', 'none')
        .attr('stroke', color1)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.85)
        .attr('d', line);
    }
    // Driver 0 (on top)
    if (s0.length) {
      linesG.append('path').datum(s0)
        .attr('fill', 'none')
        .attr('stroke', color0)
        .attr('stroke-width', 1.5)
        .attr('d', line);
    }

    // Axes
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', cGrid);
      sel.selectAll<SVGTextElement, unknown>('text')
        .attr('fill', cText)
        .attr('font-size', 9)
        .attr('font-family', fontMono);
      sel.selectAll('.tick line').attr('stroke', cGrid);
    };
    void cBg; // referenced below in future callers if needed

    g.append('g').attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d => `${Math.round((d as number) * 100)}%`))
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d =>
        chDef.key === 'rpm' ? `${((d as number) / 1000).toFixed(0)}k` : String(d),
      ))
      .call(styleAxis);

  }, [width, s0, s1, color0, color1, chDef, targetLap, dn0]);

  // ── D3 delta chart ─────────────────────────────────────
  const drawDelta = useCallback(() => {
    const el = deltaSvgRef.current;
    if (!el || !delta.length) {
      if (el) d3.select(el).selectAll('*').remove();
      return;
    }

    const cs = getComputedStyle(el);
    const cGrid    = cs.getPropertyValue('--border').trim() || '#27272a';
    const cMuted   = cs.getPropertyValue('--text-muted').trim() || '#52525b';
    const fontUI   = cs.getPropertyValue('--font').trim() || 'Titillium Web, sans-serif';
    const fontMono = cs.getPropertyValue('--mono').trim() || 'JetBrains Mono, monospace';

    const H = 64;
    const M = { top: 4, right: 14, bottom: 16, left: 42 };
    const iW = width - M.left - M.right;
    const iH = H - M.top - M.bottom;

    const svg = d3.select(el).attr('width', width).attr('height', H);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    svg.append('defs').append('clipPath').attr('id', `delta-clip-${dn0}`)
      .append('rect').attr('width', iW).attr('height', iH);

    const dMax = Math.max(Math.abs(d3.min(delta, d => d.y) ?? 0), Math.abs(d3.max(delta, d => d.y) ?? 0), 1);
    const x = d3.scaleLinear().domain([0, 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([-dMax, dMax]).range([iH, 0]);

    // Zero line
    g.append('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', y(0)).attr('y2', y(0))
      .attr('stroke', cGrid).attr('stroke-width', 1);

    // Area above zero = driver 0 faster, below = driver 1 faster
    const areaG = g.append('g').attr('clip-path', `url(#delta-clip-${dn0})`);

    const areaAbove = d3.area<{ x: number; y: number }>()
      .x(d => x(d.x)).y0(y(0)).y1(d => y(Math.max(0, d.y)))
      .curve(d3.curveMonotoneX);
    areaG.append('path').datum(delta)
      .attr('fill', color0).attr('fill-opacity', 0.4).attr('d', areaAbove);

    const areaBelow = d3.area<{ x: number; y: number }>()
      .x(d => x(d.x)).y0(y(0)).y1(d => y(Math.min(0, d.y)))
      .curve(d3.curveMonotoneX);
    areaG.append('path').datum(delta)
      .attr('fill', color1).attr('fill-opacity', 0.4).attr('d', areaBelow);

    // Delta zero-crossing line
    const line = d3.line<{ x: number; y: number }>()
      .x(d => x(d.x)).y(d => y(d.y)).curve(d3.curveMonotoneX);
    areaG.append('path').datum(delta)
      .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.25)').attr('stroke-width', 1)
      .attr('d', line);

    // Labels
    const fmt = (v: number) => chDef.key === 'rpm' ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
    g.append('text').attr('x', -4).attr('y', 2)
      .attr('text-anchor', 'end').attr('fill', color0)
      .attr('font-size', 8).attr('font-family', fontUI).attr('font-weight', 700)
      .text(drv0?.name_acronym ?? '');
    g.append('text').attr('x', -4).attr('y', iH)
      .attr('text-anchor', 'end').attr('fill', color1)
      .attr('font-size', 8).attr('font-family', fontUI).attr('font-weight', 700)
      .text(drv1?.name_acronym ?? '');

    // Min/max labels
    const maxVal = d3.max(delta, d => d.y) ?? 0;
    const minVal = d3.min(delta, d => d.y) ?? 0;
    g.append('text').attr('x', 2).attr('y', 10)
      .attr('fill', color0).attr('font-size', 8).attr('font-family', fontMono)
      .text(`+${fmt(maxVal)}`);
    if (minVal < 0) {
      g.append('text').attr('x', 2).attr('y', iH - 2)
        .attr('fill', color1).attr('font-size', 8).attr('font-family', fontMono)
        .text(`${fmt(minVal)}`);
    }

    // x axis
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', cGrid);
      sel.selectAll<SVGTextElement, unknown>('text')
        .attr('fill', cMuted)
        .attr('font-size', 8)
        .attr('font-family', fontMono);
      sel.selectAll('.tick line').attr('stroke', cGrid);
    };
    g.append('g').attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d => `${Math.round((d as number) * 100)}%`))
      .call(styleAxis);

  }, [width, delta, color0, color1, drv0, drv1, chDef, dn0]);

  useEffect(() => { drawMain(); }, [drawMain]);
  useEffect(() => { drawDelta(); }, [drawDelta]);

  // ── Mid-lap current values for legend ──────────────────
  const [midVal0, midVal1] = useMemo(() => {
    const mid = (s: typeof s0) => {
      const pts = s.filter(p => p.x > 0.45 && p.x < 0.55);
      return pts.length ? Math.round(pts.reduce((a, p) => a + p.y, 0) / pts.length) : null;
    };
    return [mid(s0), mid(s1)];
  }, [s0, s1]);

  const fmtVal = (v: number | null) => {
    if (v === null) return '—';
    return chDef.key === 'rpm' ? `${(v / 1000).toFixed(1)}k` : `${v} ${chDef.unit}`;
  };

  return (
    <div className="speed-trace" ref={wrapRef}>
      {/* Controls row */}
      <div className="speed-trace-controls">
        <div className="speed-trace-channels">
          {CHANNELS.map(c => (
            <button
              key={c.key}
              className={`speed-trace-ch${channel === c.key ? ' active' : ''}`}
              style={channel === c.key ? { borderBottomColor: `var(${c.cssVar})`, color: `var(${c.cssVar})` } : {}}
              onClick={() => setChannel(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="speed-trace-lap-nav">
          <button
            className="speed-trace-nav-btn"
            disabled={targetLap === null || targetLap <= 1}
            onClick={() => setLapOffset(o => o - 1)}
            aria-label="Previous lap"
          >◀</button>
          <span className="speed-trace-lap-num">
            {targetLap !== null ? `Lap ${targetLap}` : '—'}
          </span>
          <button
            className="speed-trace-nav-btn"
            disabled={targetLap === null || targetLap >= maxLap}
            onClick={() => setLapOffset(o => o + 1)}
            aria-label="Next lap"
          >▶</button>
          {lapOffset !== 0 && (
            <button
              className="speed-trace-nav-btn speed-trace-nav-reset"
              onClick={() => setLapOffset(0)}
              title="Back to current lap"
            >↺</button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="speed-trace-legend">
        {([
          [drv0, midVal0, color0],
          [drv1, midVal1, color1],
        ] as const).map(([drv, val, col], i) => drv && (
          <span key={i} className="speed-trace-legend-item">
            <span className="speed-trace-legend-swatch" style={{ background: col }} />
            <span style={{ color: col, fontWeight: 700 }}>{drv.name_acronym}</span>
            <span className="speed-trace-legend-val">{fmtVal(val)}</span>
          </span>
        ))}
        {s0.length > 0 && s1.length > 0 && (
          <span className="speed-trace-legend-hint">
            shading = faster section
          </span>
        )}
      </div>

      {/* Main speed trace */}
      <svg ref={mainSvgRef} className="speed-trace-svg" />

      {/* Delta area */}
      {delta.length > 0 && (
        <div className="speed-trace-delta-wrap">
          <span className="speed-trace-delta-label">Δ {chDef.label}</span>
          <svg ref={deltaSvgRef} className="speed-trace-svg" />
        </div>
      )}
    </div>
  );
}
