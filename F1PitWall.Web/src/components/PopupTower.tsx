import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { useReplayReceiver } from '../hooks/useReplayBroadcast';
import { ReplayTimingTower } from './RaceReplay';

export function PopupTower({ sessionKey }: { sessionKey: number }) {
  const [highlightedDriver, setHighlightedDriver] = useState<number | null>(null);
  const engine = useReplayEngine({ sessionKey, highlightedDriver });
  const { towerRows, totalLaps, isQualifying, scrub, setSpeed } = engine;

  useReplayReceiver(sessionKey, { scrub, setSpeed });

  return (
    <div className="popup-root popup-tower-root">
      <div className="popup-session-label">
        {engine.selectedSession?.circuit_short_name ?? '…'} — {engine.selectedSession?.session_name ?? ''}
      </div>
      <ReplayTimingTower
        rows={towerRows}
        highlighted={highlightedDriver}
        onSelectDriver={setHighlightedDriver}
        totalLaps={totalLaps}
        isQualifying={isQualifying}
      />
    </div>
  );
}
