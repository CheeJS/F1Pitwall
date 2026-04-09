import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { useReplayReceiver } from '../hooks/useReplayBroadcast';
import { ChartPanel } from './RaceReplay';

export function PopupTelemetry({ sessionKey }: { sessionKey: number }) {
  const [comparedDrivers, setComparedDrivers] = useState<number[]>([]);
  const engine = useReplayEngine({ sessionKey, highlightedDriver: comparedDrivers[0] ?? null, comparedDrivers });
  const { drivers, carDataMap, laps, stintIdx, rs, minTime, maxTime, scrub, setSpeed } = engine;

  useReplayReceiver(sessionKey, { scrub, setSpeed });

  return (
    <div className="popup-root popup-telem-root">
      <div className="popup-session-label">
        {engine.selectedSession?.circuit_short_name ?? '…'} — {engine.selectedSession?.session_name ?? ''}
      </div>
      <div className="popup-telem-fill">
        <ChartPanel
          drivers={drivers}
          carDataMap={carDataMap}
          laps={laps}
          stintIdx={stintIdx}
          currentTime={rs.currentTime}
          minTime={minTime}
          maxTime={maxTime}
          onScrub={scrub}
          comparedDrivers={comparedDrivers}
          onComparedChange={setComparedDrivers}
        />
      </div>
    </div>
  );
}
