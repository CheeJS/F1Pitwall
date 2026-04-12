import React, { useEffect, useRef, useState } from 'react';
import type { DriverState } from '../types';
import { getTyreStyle, teamColor, formatGap } from '../utils/formatters';

interface Props {
  driver: DriverState;
  isLeader: boolean;
  fastestLap: string | null;
  isSelected: boolean;
  onClick: () => void;
}

export const DriverRow = React.memo(function DriverRow({
  driver,
  isLeader,
  fastestLap,
  isSelected,
  onClick,
}: Props) {
  // ── Position change flash ─────────────────────────────
  const prevPos = useRef(driver.position);
  const [flashClass, setFlashClass] = useState('');

  useEffect(() => {
    const prev = prevPos.current;
    if (prev !== 0 && prev !== driver.position) {
      const cls = driver.position < prev ? 'flash-up' : 'flash-down';
      setFlashClass(cls);
      prevPos.current = driver.position;
      const id = setTimeout(() => setFlashClass(''), 1200);
      return () => clearTimeout(id);
    }
    prevPos.current = driver.position;
  }, [driver.position]);

  // ── Lap time classification ───────────────────────────
  const lapTimeClass =
    driver.lastLapTime && driver.lastLapTime === fastestLap
      ? 'cell-lap-time fastest'
      : 'cell-lap-time normal';

  const tyre = getTyreStyle(driver.tyreCompound);
  const colour = teamColor(driver.teamColour);
  const gapText = formatGap(driver.gapToLeader, isLeader);
  const intervalText = formatGap(driver.interval, isLeader);

  const rowClasses = [
    'driver-row',
    flashClass,
    isSelected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <tr
      className={rowClasses}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Driver ${driver.abbreviation}, position ${driver.position}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      {/* Position */}
      <td className="cell-pos">
        {/* Team colour left-border — the sole decorative element; carries data meaning */}
        <span
          className="team-bar"
          style={{ background: colour }}
          aria-hidden="true"
        />
        {driver.position > 0 ? driver.position : '—'}
      </td>

      {/* Driver */}
      <td>
        <div className="cell-driver">
          <span className="driver-number">{driver.driverNumber}</span>
          <span className="driver-abbr">{driver.abbreviation || `#${driver.driverNumber}`}</span>
        </div>
      </td>

      {/* Gap to leader */}
      <td className="cell-mono">
        {isLeader ? (
          <span className="cell-mono leader">Leader</span>
        ) : (
          gapText || '—'
        )}
      </td>

      {/* Interval */}
      <td className="cell-mono">{isLeader ? '' : intervalText || '—'}</td>

      {/* Last lap time */}
      <td className={lapTimeClass}>{driver.lastLapTime ?? '—'}</td>

      {/* Current lap */}
      <td className="cell-lap-num">
        {driver.currentLap > 0 ? driver.currentLap : '—'}
      </td>

      {/* Tyre compound + age */}
      <td>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span
            className="tyre-badge"
            style={{ background: tyre.bg, color: tyre.color }}
            title={driver.tyreCompound ?? 'Unknown'}
            aria-label={`Tyre: ${driver.tyreCompound ?? 'Unknown'}`}
          >
            {tyre.label}
          </span>
          {driver.tyreAge > 0 && (
            <span className="tyre-age">{driver.tyreAge}</span>
          )}
        </div>
      </td>

      {/* Pit stop count */}
      <td className="cell-pit-count">
        {driver.pitStopCount > 0 ? driver.pitStopCount : '—'}
      </td>

      {/* Status icons */}
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {driver.inPit && <span className="icon-pit" aria-label="In pit lane">P</span>}
          {driver.drsOpen && (
            <span
              className="icon-drs"
              title="DRS open"
              aria-label="DRS open"
            />
          )}
        </div>
      </td>
    </tr>
  );
});
