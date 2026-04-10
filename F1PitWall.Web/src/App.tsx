import { useState } from 'react';
import { useHistoricalData } from './hooks/useHistoricalData';
import { Header, type AppMode } from './components/Header';
import { SessionBrowser } from './components/SessionBrowser';
import { RaceReplay } from './components/RaceReplay';
import { LiveDashboard } from './components/LiveDashboard';

export default function App() {
  const [mode, setMode] = useState<AppMode>('live');

  // ── History mode ───────────────────────────────────────
  const historical = useHistoricalData(2026);
  const [historyReplayDriver, setHistoryReplayDriver] = useState<number | null>(null);

  return (
    <div className="app">
      <Header raceState={null} mode={mode} onModeChange={setMode} />

      {/* ── Live ── */}
      {mode === 'live' && <LiveDashboard onModeChange={setMode} />}

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
              initialSessionKey={historical.selectedSession?.sessionKey ?? undefined}
              sessionInfo={historical.selectedSession ? {
                session_key: historical.selectedSession.sessionKey,
                session_name: historical.selectedSession.sessionName,
                session_type: historical.selectedSession.sessionType,
                date_start: historical.selectedSession.dateStart,
                circuit_short_name: historical.selectedSession.circuitShortName,
                country_name: historical.selectedSession.countryName,
                year: historical.selectedSession.year,
              } : null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
