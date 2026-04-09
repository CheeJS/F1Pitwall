import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { useReplayReceiver } from '../hooks/useReplayBroadcast';
import { TrackMap } from './TrackMap';

export function PopupMap({ sessionKey }: { sessionKey: number }) {
  const [highlightedDriver, setHighlightedDriver] = useState<number | null>(null);
  const engine = useReplayEngine({ sessionKey, highlightedDriver });
  const { driverMarkers, trackPoints, circuitInfo, scrub, setSpeed } = engine;

  useReplayReceiver(sessionKey, { scrub, setSpeed });

  return (
    <div className="popup-root popup-map-root">
      <div className="popup-session-label">
        {engine.selectedSession?.circuit_short_name ?? '…'} — {engine.selectedSession?.session_name ?? ''}
      </div>
      <div className="popup-map-fill">
        <TrackMap
          markers={driverMarkers}
          highlighted={highlightedDriver}
          onSelectDriver={setHighlightedDriver}
          trackPoints={trackPoints ?? undefined}
          circuitInfo={circuitInfo ?? undefined}
        />
      </div>
    </div>
  );
}
