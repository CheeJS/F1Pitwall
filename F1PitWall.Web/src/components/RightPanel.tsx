import { useEffect, useState, useMemo } from 'react';
import { OF1, safeMediaUrl, type OF1Lap, type OF1Stint, type OF1TeamRadio } from '../api/openf1Direct';

interface Props {
  sessionKey: number | null;
  driverNumber: number | null;
  onClose: () => void;
}

function fmtLap(secs: number | null): string {
  if (secs === null) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${s}` : secs.toFixed(3);
}

const COMPOUND_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  SOFT:   { bg: '#ef4444', color: '#fff', label: 'S' },
  MEDIUM: { bg: '#eab308', color: '#000', label: 'M' },
  HARD:   { bg: '#f4f4f5', color: '#000', label: 'H' },
  INTER:  { bg: '#22c55e', color: '#000', label: 'I' },
  WET:    { bg: '#3b82f6', color: '#fff', label: 'W' },
};

function CompoundBadge({ compound }: { compound: string }) {
  const style = COMPOUND_STYLE[compound?.toUpperCase()] ?? { bg: '#52525b', color: '#fff', label: '?' };
  return (
    <span
      className="rp-compound"
      style={{ background: style.bg, color: style.color }}
      aria-label={`Compound: ${compound}`}
    >
      <span aria-hidden="true">{style.label}</span>
    </span>
  );
}

export function RightPanel({ sessionKey, driverNumber }: Props) {
  const [laps, setLaps] = useState<OF1Lap[]>([]);
  const [stints, setStints] = useState<OF1Stint[]>([]);
  const [radios, setRadios] = useState<OF1TeamRadio[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'laps' | 'stints' | 'radio'>('laps');

  useEffect(() => {
    if (!sessionKey || driverNumber === null) {
      setLaps([]); setStints([]); setRadios([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    Promise.all([
      OF1.laps({ session_key: sessionKey, driver_number: driverNumber }, ac.signal),
      OF1.stints({ session_key: sessionKey, driver_number: driverNumber }, ac.signal),
      OF1.teamRadio({ session_key: sessionKey, driver_number: driverNumber }, ac.signal),
    ])
      .then(([lapData, stintData, radioData]) => {
        setLaps(lapData.sort((a, b) => b.lap_number - a.lap_number));
        setStints(stintData.sort((a, b) => b.stint_number - a.stint_number));
        setRadios(radioData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [sessionKey, driverNumber]);

  const bestLap = useMemo(() => {
    const times = laps.map(l => l.lap_duration).filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }, [laps]);

  if (driverNumber === null) {
    return (
      <aside className="rp-root rp-empty">
        <div className="rp-empty-text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="rp-empty-icon">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/>
          </svg>
          <span>Select a driver to view lap data, stints, and radio.</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rp-root">
      {/* Best lap */}
      {bestLap !== null && (
        <div className="rp-best-lap">
          <span className="rp-best-label">Best lap</span>
          <span className="rp-best-val">{fmtLap(bestLap)}</span>
        </div>
      )}

      {/* Tab bar */}
      <div className="rp-tabs" role="tablist" aria-label="Driver data">
        {(['laps', 'stints', 'radio'] as const).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`rp-panel-${t}`}
            id={`rp-tab-${t}`}
            className={`rp-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'laps' ? `Laps (${laps.length})` : t === 'stints' ? `Stints (${stints.length})` : `Radio (${radios.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="rp-loading" aria-live="polite" aria-busy="true"><span className="spinner" aria-hidden="true" /> Loading…</div>
      )}

      {/* Laps tab */}
      {!loading && tab === 'laps' && (
        <div className="rp-scroll" role="tabpanel" id="rp-panel-laps" aria-labelledby="rp-tab-laps">
          {laps.length === 0 ? (
            <div className="rp-tab-empty">No lap data available.</div>
          ) : (
            <table className="rp-table">
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
                {laps.map(l => {
                  const isBest = l.lap_duration === bestLap;
                  return (
                    <tr key={l.lap_number} className={isBest ? 'rp-tr-best' : ''}>
                      <td className="rp-td-num">{l.lap_number}</td>
                      <td className={`rp-td-time${isBest ? ' best' : ''}`}>{fmtLap(l.lap_duration)}</td>
                      <td className="rp-td-sector">{l.duration_sector_1?.toFixed(3) ?? '—'}</td>
                      <td className="rp-td-sector">{l.duration_sector_2?.toFixed(3) ?? '—'}</td>
                      <td className="rp-td-sector">{l.duration_sector_3?.toFixed(3) ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Stints tab */}
      {!loading && tab === 'stints' && (
        <div className="rp-scroll" role="tabpanel" id="rp-panel-stints" aria-labelledby="rp-tab-stints">
          {stints.length === 0 ? (
            <div className="rp-tab-empty">No stint data.</div>
          ) : (
            <div className="rp-stints">
              {stints.map(s => (
                <div key={s.stint_number} className="rp-stint-row">
                  <CompoundBadge compound={s.compound} />
                  <div className="rp-stint-info">
                    <span className="rp-stint-compound">{s.compound}</span>
                    <span className="rp-stint-laps">
                      L{s.lap_start}–{s.lap_end ?? '?'} · {s.lap_end && s.lap_end - s.lap_start + 1} laps
                    </span>
                  </div>
                  <span className="rp-stint-age">Age {s.tyre_age_at_start}L</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Radio tab */}
      {!loading && tab === 'radio' && (
        <div className="rp-scroll" role="tabpanel" id="rp-panel-radio" aria-labelledby="rp-tab-radio">
          {radios.length === 0 ? (
            <div className="rp-tab-empty">No radio recordings.</div>
          ) : (
            <div className="rp-radios">
              {radios.map((r, i) => {
                const safe = safeMediaUrl(r.recording_url);
                if (!safe) return null;
                return (
                  <div key={i} className="rp-radio-item">
                    <span className="rp-radio-time">{new Date(r.date).toISOString().slice(11, 19)}</span>
                    <audio
                      controls
                      src={safe}
                      className="rp-audio"
                      preload="none"
                      aria-label={`Team radio at ${new Date(r.date).toISOString().slice(11, 19)}`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
