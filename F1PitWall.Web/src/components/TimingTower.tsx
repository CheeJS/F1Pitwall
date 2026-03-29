import { useMemo } from 'react';
import type { RaceState } from '../types';
import { findFastestLap } from '../utils/formatters';
import { DriverRow } from './DriverRow';

interface Props {
  raceState: RaceState | null;
  selectedDriverNumber: number | null;
  onSelectDriver: (n: number) => void;
}

export function TimingTower({ raceState, selectedDriverNumber, onSelectDriver }: Props) {
  // Sort drivers by position ascending; unpositioned drivers go to the bottom
  const sorted = useMemo(() => {
    if (!raceState) return [];
    return Object.values(raceState.drivers).sort(
      (a, b) => (a.position || 99) - (b.position || 99),
    );
  }, [raceState]);

  // Session-fastest lap — highlight in purple, like the real F1 timing screen
  const fastestLap = useMemo(
    () => (raceState ? findFastestLap(raceState.drivers) : null),
    [raceState],
  );

  if (!raceState) {
    return (
      <div className="timing-tower-wrap">
        <div className="empty-state">
          <p className="empty-state-title">Waiting for session data…</p>
          <p className="empty-state-sub">Connect to the backend and a live session will appear here.</p>
        </div>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="timing-tower-wrap">
        <div className="empty-state">
          <p className="empty-state-title">No drivers in session</p>
          <p className="empty-state-sub">Driver data will populate once the session starts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timing-tower-wrap">
      <table className="timing-table" aria-label="Live timing tower">
        <colgroup>
          <col className="col-pos" />
          <col className="col-driver" />
          <col className="col-gap" />
          <col className="col-int" />
          <col className="col-lap-time" />
          <col className="col-lap" />
          <col className="col-tyre" />
          <col className="col-pit" />
          <col className="col-status" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">P</th>
            <th scope="col">Driver</th>
            <th scope="col" className="right">Gap</th>
            <th scope="col" className="right">Int</th>
            <th scope="col" className="right">Last lap</th>
            <th scope="col" className="right">Lap</th>
            <th scope="col">Tyre</th>
            <th scope="col" className="right" title="Pit stops">Pit</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((driver, idx) => (
            <DriverRow
              key={driver.driverNumber}
              driver={driver}
              isLeader={idx === 0}
              fastestLap={fastestLap}
              isSelected={driver.driverNumber === selectedDriverNumber}
              onClick={() => onSelectDriver(driver.driverNumber)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
