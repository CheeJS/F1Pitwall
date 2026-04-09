import { useMemo } from 'react';
import type { F1Session, DriverClassification } from '../types';

// ── Team colour helper (reuse from formatters) ─────────────
function teamBg(hex: string): string {
  return hex ? `#${hex}` : 'var(--text-muted)';
}

interface Props {
  session: F1Session | null;
  classification: DriverClassification[] | null;
  loading: boolean;
  error: string | null;
}

export function HistoricalTower({ session, classification, loading, error }: Props) {
  // Fastest lap index (purple highlight)
  const fastestIdx = useMemo(() => {
    if (!classification) return -1;
    let best: number | null = null;
    let idx = -1;
    classification.forEach((d, i) => {
      if (d.bestLapSeconds !== null && (best === null || d.bestLapSeconds < best)) {
        best = d.bestLapSeconds;
        idx = i;
      }
    });
    return idx;
  }, [classification]);

  // ── Empty state ───────────────────────────────────────────
  if (!session) {
    return (
      <div className="history-main history-empty">
        <p>Select a session from the left to view classification</p>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="history-main history-loading">
        <span className="spinner" />
        <span>Loading classification…</span>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────
  if (error) {
    return (
      <div className="history-main history-error">
        <p>Failed to load classification</p>
        <p className="error-detail">{error}</p>
      </div>
    );
  }

  // ── No data ───────────────────────────────────────────────
  if (!classification || classification.length === 0) {
    return (
      <div className="history-main history-empty">
        <p>No classification data available for this session</p>
      </div>
    );
  }

  // ── Classification table ──────────────────────────────────
  const isQualifying = session.sessionType.toLowerCase().includes('qualifying') ||
    session.sessionType.toLowerCase().includes('sprint shootout');

  return (
    <div className="history-main">
      {/* Session header */}
      <div className="history-header">
        <div className="history-header-left">
          <span className="history-circuit">{session.circuitShortName}</span>
          <span className="history-meeting">{session.meetingName}</span>
        </div>
        <div className="history-header-right">
          <span className="history-session-name">{session.sessionName}</span>
          <span className="history-date">
            {new Date(session.dateStart).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div className="timing-table">
        <div className="timing-header">
          <span className="col-pos">POS</span>
          <span className="col-driver">DRIVER</span>
          {isQualifying ? (
            <span className="col-best col-right">BEST LAP</span>
          ) : (
            <>
              <span className="col-laps col-right">LAPS</span>
              <span className="col-best col-right">BEST LAP</span>
            </>
          )}
        </div>

        {classification.map((driver, i) => (
          <div
            key={driver.driverNumber}
            className={`timing-row${i === fastestIdx ? ' fastest' : ''}`}
          >
            {/* Position */}
            <span className="col-pos pos-static">{driver.position}</span>

            {/* Driver */}
            <span className="col-driver">
              <span
                className="team-bar"
                style={{ background: teamBg(driver.teamColour) }}
              />
              <span className="driver-num">{driver.driverNumber}</span>
              <span className="driver-abbr">{driver.abbreviation}</span>
            </span>

            {/* Laps (race only) */}
            {!isQualifying && (
              <span className="col-laps col-right lap-count">
                {driver.totalLaps > 0 ? driver.totalLaps : '–'}
              </span>
            )}

            {/* Best lap */}
            <span className={`col-best col-right${i === fastestIdx ? ' fastest-lap' : ''}`}>
              {driver.bestLapTime ?? '–'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
