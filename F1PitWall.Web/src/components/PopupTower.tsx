import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { useReplayReceiver } from '../hooks/useReplayBroadcast';
import { ReplayTimingTower } from './RaceReplay';
import { PopupFrame } from './PopupFrame';

export function PopupTower({ sessionKey }: { sessionKey: number }) {
  const [highlightedDriver, setHighlightedDriver] = useState<number | null>(null);
  const [mainClosed, setMainClosed] = useState(false);
  const engine = useReplayEngine({ sessionKey, highlightedDriver });
  const { towerRows, totalLaps, isQualifying, scrub, setSpeed, loading, error, selectedSession } = engine;

  useReplayReceiver(sessionKey, {
    scrub,
    setSpeed,
    setHighlightedDriver,
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
      className="popup-tower-root"
    >
      {mainClosed && <div className="popup-detached-banner">Main window closed — popup is no longer syncing.</div>}
      <ReplayTimingTower
        rows={towerRows}
        highlighted={highlightedDriver}
        onSelectDriver={setHighlightedDriver}
        totalLaps={totalLaps}
        isQualifying={isQualifying}
      />
    </PopupFrame>
  );
}
