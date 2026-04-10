import { useState } from 'react';
import { useLiveEngine, type LiveStatus } from '../hooks/useLiveEngine';
import { ReplayTimingTower, RaceMessages } from './RaceReplay';
import { TrackMap } from './TrackMap';
import { ChampionshipStandings } from './ChampionshipStandings';
import type { AppMode } from './Header';

const SC_LABEL: Record<string, string> = {
  SC:  'Safety Car',
  VSC: 'Virtual Safety Car',
  Red: 'Red Flag',
};

function StatusDot({ status }: { status: LiveStatus }) {
  const label: Record<LiveStatus, string> = {
    idle:       'Idle',
    loading:    'Loading…',
    polling:    'Test mode',
    connecting: 'Connecting…',
    connected:  'Live',
    error:      'Connection error',
  };
  const cls: Record<LiveStatus, string> = {
    idle:       'live-dot--idle',
    loading:    'live-dot--loading',
    polling:    'live-dot--polling',
    connecting: 'live-dot--loading',
    connected:  'live-dot--connected',
    error:      'live-dot--error',
  };
  return (
    <span className={`live-status-dot ${cls[status]}`} title={label[status]}>
      {label[status]}
    </span>
  );
}

// ── Idle landing shown when no active session ────────────

function LiveIdleState({ onGoHistory }: { onGoHistory: () => void }) {
  return (
    <div className="live-idle">
      <div className="live-idle-topbar">
        <span className="live-idle-no-session">No live session — connect automatically when a race weekend starts</span>
        <button className="live-idle-history-btn" onClick={onGoHistory}>
          Browse past races →
        </button>
      </div>
      <ChampionshipStandings year={2026} />
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────

interface LiveDashboardProps {
  onModeChange?: (mode: AppMode) => void;
}

export function LiveDashboard({ onModeChange }: LiveDashboardProps) {
  const [highlighted, setHighlighted] = useState<number | null>(null);

  const {
    towerRows,
    isQualifying,
    selectedSession,
    safetyCarStatus,
    status,
    driverMarkers,
    raceControlMessages,
    trackPoints,
    circuitInfo,
    currentSimTime,
  } = useLiveEngine();

  const activeSc = safetyCarStatus && safetyCarStatus !== 'None' ? safetyCarStatus : null;

  // Show idle landing when no session data exists (regardless of connection state)
  if (!selectedSession) {
    return (
      <div className="live-dashboard">
        <div className="live-dashboard-header">
          <span className="live-dashboard-session">F1 PitWall — Live</span>
          <StatusDot status={status} />

        </div>
        <LiveIdleState onGoHistory={() => onModeChange?.('history')} />
      </div>
    );
  }

  return (
    <div className="live-dashboard">
      {/* Session label + connection status */}
      <div className="live-dashboard-header">
        <span className="live-dashboard-session">
          {selectedSession
            ? `${selectedSession.circuit_short_name} — ${selectedSession.session_name}`
            : 'Waiting for session…'}
        </span>
        <StatusDot status={status} />
      </div>

      {/* Safety car / red flag banner */}
      {activeSc && (
        <div className={`sc-banner ${activeSc === 'SC' ? 'sc' : activeSc === 'VSC' ? 'vsc' : 'red'}`}>
          <span className="sc-banner-dot" />
          {SC_LABEL[activeSc] ?? activeSc}
        </div>
      )}

      {/* Main canvas: tower | map + race control */}
      <div className="live-canvas">
        {/* Left: timing tower with pit stops column */}
        <div className="live-tower-wrap">
          <ReplayTimingTower
            rows={towerRows}
            highlighted={highlighted}
            onSelectDriver={setHighlighted}
            totalLaps={0}
            isQualifying={isQualifying}
            showPitStops={!isQualifying}
          />
        </div>

        {/* Center: track map with race control overlaid */}
        <div className="live-center">
          <div className="live-map-area">
            <TrackMap
              markers={driverMarkers}
              highlighted={highlighted}
              onSelectDriver={setHighlighted}
              trackPoints={trackPoints ?? undefined}
              circuitInfo={circuitInfo ?? undefined}
            />
            <RaceMessages
              messages={raceControlMessages}
              currentTime={currentSimTime}
              overlay
              maxMessages={8}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
