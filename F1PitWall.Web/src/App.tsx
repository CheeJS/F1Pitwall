import { useState } from 'react';
import { useRaceStore } from './store/raceStore';
import { useRaceConnection } from './hooks/useRaceConnection';
import { useHistoricalData } from './hooks/useHistoricalData';
import { Header, type AppMode } from './components/Header';
import { TimingTower } from './components/TimingTower';
import { DriverPanel } from './components/DriverPanel';
import { StatusBar } from './components/StatusBar';
import { SessionBrowser } from './components/SessionBrowser';
import { ExplorerSidebar, type EndpointId } from './components/ExplorerSidebar';
import { DataExplorer } from './components/DataExplorer';
import { RaceReplay } from './components/RaceReplay';
import { RightPanel } from './components/RightPanel';

export default function App() {
  const [mode, setMode] = useState<AppMode>('live');

  // ── Live mode ──────────────────────────────────────────
  const {
    state,
    setFullState,
    applyDriverUpdate,
    applyCarData,
    applySessionStatus,
    applySafetyCar,
    setConnectionStatus,
    selectDriver,
  } = useRaceStore();

  useRaceConnection({
    onFullState: setFullState,
    onDriverUpdate: applyDriverUpdate,
    onCarData: applyCarData,
    onSessionStatus: applySessionStatus,
    onSafetyCar: applySafetyCar,
    onConnectionChange: setConnectionStatus,
  });

  // ── History mode ───────────────────────────────────────
  const historical = useHistoricalData(2026);
  const [historyReplayDriver, setHistoryReplayDriver] = useState<number | null>(null);

  // ── Explorer mode ──────────────────────────────────────
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointId>('sessions');
  // Explorer right panel
  const [explorerDriver, setExplorerDriver] = useState<number | null>(null);

  const { raceState, connectionStatus, selectedDriverNumber, lastUpdateTime } = state;
  const panelOpen = selectedDriverNumber !== null;
  const selectedDriver =
    raceState && selectedDriverNumber !== null
      ? raceState.drivers[String(selectedDriverNumber)] ?? null
      : null;

  return (
    <div className="app">
      <Header raceState={raceState} mode={mode} onModeChange={setMode} />

      {/* ── Live ── */}
      {mode === 'live' && (
        <div className={`app-body${panelOpen ? ' panel-open' : ''}`}>
          <TimingTower
            raceState={raceState}
            selectedDriverNumber={selectedDriverNumber}
            onSelectDriver={selectDriver}
          />
          {panelOpen && (
            <DriverPanel
              driver={selectedDriver}
              onClose={() => selectDriver(null)}
            />
          )}
        </div>
      )}

      {/* ── History ── */}
      {mode === 'history' && (
        <div className="history-layout">
          <SessionBrowser
            year={historical.year}
            setYear={historical.setYear}
            sessions={historical.sessions}
            selectedSession={historical.selectedSession}
            onSelectSession={historical.setSelectedSession}
            loading={historical.loadingSessions}
            error={historical.error}
          />
          <div className="history-replay-wrap">
            <RaceReplay
              highlightedDriver={historyReplayDriver}
              onSelectDriver={setHistoryReplayDriver}
              initialSessionKey={historical.selectedSession?.sessionKey}
              onBack={() => historical.setSelectedSession(null)}
            />
          </div>
        </div>
      )}

      {/* ── Explorer ── */}
      {mode === 'explorer' && (
        <div className="explorer-layout">
          <ExplorerSidebar active={activeEndpoint} onChange={id => { setActiveEndpoint(id); setExplorerDriver(null); }} />
          <div className="explorer-main">
            <DataExplorer endpointId={activeEndpoint} />
          </div>
          <RightPanel
            sessionKey={null}
            driverNumber={explorerDriver}
            onClose={() => setExplorerDriver(null)}
          />
        </div>
      )}

      <StatusBar
        connectionStatus={connectionStatus}
        lastUpdateTime={lastUpdateTime}
        driverCount={raceState ? Object.keys(raceState.drivers).length : 0}
      />
    </div>
  );
}
