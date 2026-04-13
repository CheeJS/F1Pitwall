import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { useReplayReceiver } from '../hooks/useReplayBroadcast';
import { ChartPanel } from './RaceReplay';
import { PopupFrame } from './PopupFrame';

export function PopupTelemetry({ sessionKey }: { sessionKey: number }) {
  const [comparedDrivers, setComparedDrivers] = useState<number[]>([]);
  const [mainClosed, setMainClosed] = useState(false);
  const engine = useReplayEngine({ sessionKey, highlightedDriver: comparedDrivers[0] ?? null, comparedDrivers });
  const { drivers, carDataMap, laps, stintIdx, rs, minTime, maxTime, scrub, setSpeed, loading, error, selectedSession } = engine;

  useReplayReceiver(sessionKey, {
    scrub,
    setSpeed,
    onMainClosed: () => setMainClosed(true),
  });

  const label = selectedSession
    ? `${selectedSession.circuit_short_name} — ${selectedSession.session_name}`
    : 'Loading…';

  return (
    <PopupFrame
      sessionLabel={label}
      loading={loading}
      error={error}
      className="popup-telem-root"
    >
      {mainClosed && <div className="popup-detached-banner">Main window closed — popup is no longer syncing.</div>}
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
    </PopupFrame>
  );
}
