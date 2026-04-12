import { useState, useMemo, memo } from 'react';
import type { OF1Driver, OF1Stint, OF1Pit, OF1Overtake } from '../api/openf1Direct';
import { COMPOUND_STYLE, parseDate } from '../utils/replayUtils';
import type { TowerRow } from '../utils/replayUtils';

// ── Shared chevron ─────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`collapsible-chevron${open ? ' collapsible-chevron--open' : ''}`}
      viewBox="0 0 10 10" width={9} height={9}
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    >
      <path d="M2 3.5l3 3 3-3" />
    </svg>
  );
}

// ── Strategy Strip ─────────────────────────────────────────
// Tyre stint Gantt. Collapsed by default. Fills as laps complete.

export interface StrategyStripProps {
  stints: OF1Stint[];
  towerRows: TowerRow[];
  totalLaps: number;
  currentTime: number;
  lapMarkers: { t: number; lap: number }[];
}

export const StrategyStrip = memo(function StrategyStrip({
  stints, towerRows, totalLaps, currentTime, lapMarkers,
}: StrategyStripProps) {
  const [open, setOpen] = useState(false);

  const stintsByDriver = useMemo(() => {
    const m = new Map<number, OF1Stint[]>();
    for (const s of stints) {
      const arr = m.get(s.driver_number) ?? [];
      arr.push(s);
      m.set(s.driver_number, arr);
    }
    return m;
  }, [stints]);

  const maxLap = useMemo(() => {
    const fromStints = stints.length ? Math.max(...stints.map(s => s.lap_end ?? 0)) : 0;
    return Math.max(totalLaps, fromStints, 1);
  }, [stints, totalLaps]);

  const currentLap = useMemo(() => {
    const before = lapMarkers.filter(m => m.t <= currentTime);
    return before.length ? Math.max(...before.map(m => m.lap)) : 0;
  }, [lapMarkers, currentTime]);

  const rulerMarks = useMemo(() => {
    const step = maxLap <= 30 ? 5 : maxLap <= 60 ? 10 : 20;
    const marks: number[] = [];
    for (let l = step; l <= maxLap; l += step) marks.push(l);
    return marks;
  }, [maxLap]);

  return (
    <div className="collapsible-strip">
      <button className="collapsible-header" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="collapsible-title">STRATEGY</span>
        <Chevron open={open} />
      </button>

      {open && towerRows.length > 0 && (
        <div className="strategy-body">
          {/* Ruler */}
          <div className="ss-ruler-row">
            <span className="ss-label" />
            <div className="ss-ruler">
              {currentLap > 0 && (
                <div className="ss-now-ruler" style={{ left: `${(currentLap / maxLap) * 100}%` }} />
              )}
              {rulerMarks.map(l => (
                <span key={l} className="ss-ruler-mark" style={{ left: `${(l / maxLap) * 100}%` }}>
                  {l}
                </span>
              ))}
            </div>
          </div>

          {towerRows.map(row => {
            const drvStints = (stintsByDriver.get(row.driverNumber) ?? [])
              .sort((a, b) => a.lap_start - b.lap_start);
            return (
              <div key={row.driverNumber} className="ss-row">
                <span className="ss-label" style={{ color: `#${row.teamColour}` }}>
                  {row.abbreviation}
                </span>
                <div className="ss-track">
                  {currentLap > 0 && (
                    <div className="ss-now" style={{ left: `${(currentLap / maxLap) * 100}%` }} />
                  )}
                  {drvStints.map(s => {
                    // Only show stints that have started at or before currentLap
                    if (currentLap > 0 && s.lap_start > currentLap) return null;

                    // Clip the visible end to currentLap so the chart fills up lap-by-lap
                    const visibleEnd = s.lap_end !== null && s.lap_end !== undefined
                      ? Math.min(s.lap_end, currentLap > 0 ? currentLap : s.lap_end)
                      : (currentLap > 0 ? currentLap : 1);

                    const cs = COMPOUND_STYLE[s.compound];
                    const left  = ((s.lap_start - 1) / maxLap) * 100;
                    const width = (visibleEnd - s.lap_start + 1) / maxLap * 100;
                    if (width <= 0) return null;

                    return (
                      <div
                        key={s.stint_number}
                        className="ss-stint"
                        style={{ left: `${left}%`, width: `${width}%`, background: cs?.bg ?? '#555' }}
                        title={`${s.compound} · L${s.lap_start}–${s.lap_end ?? '?'} · age ${s.tyre_age_at_start}`}
                      >
                        {width > 3.5 && (
                          <span className="ss-abbr" style={{ color: cs?.fg ?? '#fff' }}>
                            {cs?.abbr ?? s.compound[0]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ── Live Events Feed ───────────────────────────────────────
// Pit stops + overtakes combined, newest first.
// Collapsed by default. Fills up as the session progresses.

export interface LiveEventsFeedProps {
  pits: OF1Pit[];
  overtakes: OF1Overtake[];
  drivers: OF1Driver[];
  currentTime: number;
  lapMarkers: { t: number; lap: number }[];
}

type LiveEvent =
  | { kind: 'pit';      t: number; lap: number; driverNumber: number; duration: number }
  | { kind: 'overtake'; t: number; lap: number; driverNumber: number; targetDriverNumber: number; position: number };

export const LiveEventsFeed = memo(function LiveEventsFeed({
  pits, overtakes, drivers, currentTime, lapMarkers,
}: LiveEventsFeedProps) {
  const [open, setOpen] = useState(false);

  const driverByNum = useMemo(
    () => new Map(drivers.map(d => [d.driver_number, d])),
    [drivers],
  );

  const events = useMemo((): LiveEvent[] => {
    const lapsSorted = [...lapMarkers].sort((a, b) => a.t - b.t);
    const getLap = (t: number) => {
      let lap = 0;
      for (const m of lapsSorted) { if (m.t <= t) lap = m.lap; else break; }
      return lap;
    };

    const result: LiveEvent[] = [];

    for (const p of pits) {
      if (!p.pit_duration || p.pit_duration <= 0) continue;
      const t = parseDate(p.date);
      if (t > currentTime) continue;
      result.push({ kind: 'pit', t, lap: p.lap_number, driverNumber: p.driver_number, duration: p.pit_duration });
    }

    for (const o of overtakes) {
      const t = parseDate(o.date);
      if (t > currentTime) continue;
      result.push({
        kind: 'overtake', t,
        lap: getLap(t),
        driverNumber: o.overtaking_driver_number,
        targetDriverNumber: o.overtaken_driver_number,
        position: o.position,
      });
    }

    return result.sort((a, b) => b.t - a.t);
  }, [pits, overtakes, currentTime, lapMarkers]);

  // Count events at current time for the header badge
  const count = events.length;

  return (
    <div className="collapsible-strip">
      <button className="collapsible-header" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="collapsible-title">
          EVENTS
          {count > 0 && <span className="collapsible-count">{count}</span>}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="lf-body">
          {events.length === 0 ? (
            <div className="lf-empty">No events yet</div>
          ) : (
            events.map((ev, i) => {
              if (ev.kind === 'pit') {
                const drv = driverByNum.get(ev.driverNumber);
                return (
                  <div key={i} className="lf-item">
                    <span className="lf-lap">L{ev.lap}</span>
                    <span className="lf-driver" style={{ color: drv ? `#${drv.team_colour}` : undefined }}>
                      {drv?.name_acronym ?? `#${ev.driverNumber}`}
                    </span>
                    <span className="lf-badge lf-badge--pit">PIT</span>
                    <span className="lf-detail">{ev.duration.toFixed(1)}s</span>
                  </div>
                );
              } else {
                const ing = driverByNum.get(ev.driverNumber);
                const ed  = driverByNum.get(ev.targetDriverNumber);
                return (
                  <div key={i} className="lf-item">
                    <span className="lf-lap">L{ev.lap}</span>
                    <span className="lf-driver" style={{ color: ing ? `#${ing.team_colour}` : undefined }}>
                      {ing?.name_acronym ?? `#${ev.driverNumber}`}
                    </span>
                    <span className="lf-badge lf-badge--ovt">OVT</span>
                    <span className="lf-detail" style={{ color: ed ? `#${ed.team_colour}` : undefined }}>
                      {ed?.name_acronym ?? `#${ev.targetDriverNumber}`}
                    </span>
                  </div>
                );
              }
            })
          )}
        </div>
      )}
    </div>
  );
});
