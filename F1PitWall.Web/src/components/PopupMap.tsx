import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { useReplayReceiver } from '../hooks/useReplayBroadcast';
import { TrackMap } from './TrackMap';
import { PopupFrame } from './PopupFrame';

export function PopupMap({ sessionKey }: { sessionKey: number }) {
  const [highlightedDriver, setHighlightedDriver] = useState<number | null>(null);
  const [mainClosed, setMainClosed] = useState(false);
  const engine = useReplayEngine({ sessionKey, highlightedDriver });
  const { driverMarkers, trackPoints, circuitInfo, scrub, setSpeed, loading, error, selectedSession } = engine;

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
      className="popup-map-root"
    >
      {mainClosed && <div className="popup-detached-banner">Main window closed — popup is no longer syncing.</div>}
      <div className="popup-map-fill">
        <TrackMap
          markers={driverMarkers}
          highlighted={highlightedDriver}
          onSelectDriver={setHighlightedDriver}
          trackPoints={trackPoints ?? undefined}
          circuitInfo={circuitInfo ?? undefined}
        />
      </div>
    </PopupFrame>
  );
}
