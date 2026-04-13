import { useMemo } from 'react';
import { useLiveEngine, type LiveStatus } from '../hooks/useLiveEngine';
import { useRaceStore } from '../store/raceStore';
import { useRaceConnection } from '../hooks/useRaceConnection';
import { ReplayTimingTower, RaceMessages } from './RaceReplay';
import { TimingTower } from './TimingTower';
import { DriverPanel } from './DriverPanel';
import { RightPanel } from './RightPanel';
import { TrackMap } from './TrackMap';
import { ChampionshipStandings } from './ChampionshipStandings';
import { fmtLap, fmtGap, fmtInterval, parseDate } from '../utils/replayUtils';
import type { DriverState } from '../types';
import type { AppMode } from './Header';

const SC_LABEL: Record<string, string> = {
  SC:  'Safety Car',
  VSC: 'Virtual Safety Car',
  Red: 'Red Flag',
};

// ── Connection status dot ────────────────────────────────

function StatusDot({ status, onReconnect }: { status: LiveStatus; onReconnect?: () => void }) {
  const label: Record<LiveStatus, string> = {
    idle:       'Idle',
    loading:    'Loading…',
    polling:    'Test mode',
    connecting: 'Connecting…',
    connected:  'Live',
    error:      'Offline',
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
    <span className="live-status-wrap">
      <span
        className={`live-status-dot ${cls[status]}`}
        role="status"
        aria-label={`Connection status: ${label[status]}`}
      >
        {label[status]}
      </span>
      {status === 'error' && onReconnect && (
        <button className="live-reconnect-btn" onClick={onReconnect} aria-label="Reconnect to server">
          Reconnect
        </button>
      )}
    </span>
  );
}

// ── Idle landing (no active session) ────────────────────

function LiveIdleState({ onGoHistory }: { onGoHistory: () => void }) {
  return (
    <div className="live-idle">
      <div className="live-idle-topbar">
        <span className="live-idle-no-session">No live session — connects automatically when a race weekend starts</span>
        <button className="live-idle-history-btn" onClick={onGoHistory}>
          Browse past races &#x2192;
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
  // ── SignalR: live driver state from C# backend ──
  // Must be initialised first so selectedDriverNumber can be passed to useLiveEngine
  const store = useRaceStore();
  const { raceState, selectedDriverNumber } = store.state;
  const { selectDriver } = store;

  // ── MQTT / REST: session detection, track map, race control ──
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
    carDataMap,
  } = useLiveEngine(selectedDriverNumber);

  const { reconnect } = useRaceConnection({
    onFullState:        store.setFullState,
    onDriverUpdate:     store.applyDriverUpdate,
    onCarData:          store.applyCarData,
    onSessionStatus:    store.applySessionStatus,
    onSafetyCar:        store.applySafetyCar,
    onConnectionChange: store.setConnectionStatus,
  });

  // ── Convert selected driver to DriverState for DriverPanel ──
  // Prefers SignalR state (live from backend). Falls back to MQTT TowerRow + carData.
  const selectedDriverState = useMemo((): DriverState | null => {
    if (selectedDriverNumber === null) return null;

    // Backend SignalR: already a typed DriverState
    const signalRDriver = raceState?.drivers[String(selectedDriverNumber)];
    if (signalRDriver) return signalRDriver;

    // MQTT fallback: build DriverState from TowerRow + car telemetry at currentSimTime
    const row = towerRows.find(r => r.driverNumber === selectedDriverNumber);
    if (!row) return null;

    // Find the most recent car data entry at or before currentSimTime (binary search)
    const carArr = carDataMap.get(selectedDriverNumber);
    let car = carArr?.[carArr.length - 1]; // default: latest (live MQTT case)
    if (carArr?.length && currentSimTime) {
      for (let i = carArr.length - 1; i >= 0; i--) {
        if (parseDate(carArr[i].date) <= currentSimTime) { car = carArr[i]; break; }
      }
    }

    // Clamp 0–100; OpenF1 occasionally returns values slightly outside range
    const clamp = (v: number) => Math.min(100, Math.max(0, v));

    return {
      driverNumber: row.driverNumber,
      abbreviation: row.abbreviation,
      teamColour:   row.teamColour,
      position:     row.position,
      lastLapTime:  row.lastLapTime !== null ? fmtLap(row.lastLapTime) : null,
      gapToLeader:  fmtGap(row.gap, row.position),
      interval:     fmtInterval(row.interval),
      currentLap:   row.currentLap,
      speed:        car?.speed               ?? 0,
      throttle:     clamp(car?.throttle      ?? 0),
      brake:        clamp(car?.brake         ?? 0),
      gear:         car?.n_gear ?? car?.gear ?? 0,
      drsOpen:      (car?.drs ?? 0) >= 10,
      tyreCompound: row.compound,
      tyreAge:      row.tyreAge   ?? 0,
      pitStopCount: row.pitStops  ?? 0,
      inPit:        row.inPits    ?? false,
      lastUpdated:  new Date().toISOString(),
    };
  }, [selectedDriverNumber, raceState, towerRows, carDataMap, currentSimTime]);

  const activeSc = safetyCarStatus && safetyCarStatus !== 'None' ? safetyCarStatus : null;

  // Idle: no session data regardless of connection state
  if (!selectedSession) {
    return (
      <div className="live-dashboard">
        <div className="live-dashboard-header">
          <span className="live-dashboard-session">F1 PitWall — Live</span>
          <StatusDot status={status} onReconnect={reconnect} />
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
          {selectedSession.circuit_short_name} — {selectedSession.session_name}
        </span>
        <StatusDot status={status} onReconnect={reconnect} />
      </div>

      {/* Safety car / red flag banner */}
      {activeSc && (
        <div className={`sc-banner ${activeSc === 'SC' ? 'sc' : activeSc === 'VSC' ? 'vsc' : 'red'}`}>
          <span className="sc-banner-dot" />
          {SC_LABEL[activeSc] ?? activeSc}
        </div>
      )}

      <div className="live-canvas">
        {/* Left: timing tower
            — uses structured TimingTower when SignalR backend has drivers
            — falls back to MQTT-derived ReplayTimingTower rows (test mode / no live session) */}
        <div className="live-tower-wrap">
          {raceState && Object.keys(raceState.drivers).length > 0 ? (
            <TimingTower
              raceState={raceState}
              selectedDriverNumber={selectedDriverNumber}
              onSelectDriver={(n) => selectDriver(n)}
            />
          ) : (
            <ReplayTimingTower
              rows={towerRows}
              highlighted={selectedDriverNumber}
              onSelectDriver={(n) => selectDriver(n)}
              totalLaps={0}
              isQualifying={isQualifying}
              showPitStops={!isQualifying}
            />
          )}
        </div>

        {/* Center: track map above, race control strip below */}
        <div className="live-center">
          <div className="live-map-area">
            <TrackMap
              markers={driverMarkers}
              highlighted={selectedDriverNumber}
              onSelectDriver={(n) => selectDriver(n)}
              trackPoints={trackPoints ?? undefined}
              circuitInfo={circuitInfo ?? undefined}
            />
          </div>
          <RaceMessages
            messages={raceControlMessages}
            currentTime={currentSimTime}
            maxMessages={5}
          />
        </div>

        {/* Right: driver detail panel (live telemetry + lap/stint/radio history) */}
        {selectedDriverNumber !== null && (
          <div className="live-right-panel">
            <DriverPanel
              driver={selectedDriverState}
              onClose={() => selectDriver(null)}
            />
            <RightPanel
              sessionKey={selectedSession.session_key}
              driverNumber={selectedDriverNumber}
              onClose={() => selectDriver(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
