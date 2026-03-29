
import type { RaceState } from '../types';

export type AppMode = 'live' | 'history' | 'explorer';

interface Props {
  raceState: RaceState | null;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

const SC_LABEL: Record<string, string> = {
  SC: 'Safety Car',
  VSC: 'Virtual SC',
  Red: 'Red Flag',
};

export function Header({ raceState, mode, onModeChange }: Props) {
  const sc = raceState?.safetyCarStatus;
  const activeSc = sc && sc !== 'None' && sc !== '' ? sc : null;

  const sessionType = raceState?.sessionType ?? null;
  const sessionStatus = raceState?.status ?? 'Inactive';
  const currentLap = raceState
    ? Math.max(...Object.values(raceState.drivers).map(d => d.currentLap), 0)
    : 0;
  const totalLaps = raceState?.totalLaps ?? 0;

  return (
    <header className="header">
      {/* Brand */}
      <span className="header-logo">
        F1 <span>Pit</span>Wall
      </span>

      <div className="header-divider" />

      {/* Session type + status */}
      <div className="header-session">
        {sessionType && (
          <span className="header-session-type">{sessionType}</span>
        )}
        <span
          className={`status-pill ${
            sessionStatus === 'Started'
              ? 'live'
              : sessionStatus === 'Finished'
              ? 'finished'
              : 'inactive'
          }`}
        >
          {sessionStatus === 'Started'
            ? 'Live'
            : sessionStatus === 'Finished'
            ? 'Finished'
            : 'Inactive'}
        </span>
      </div>

      {/* Lap counter */}
      {totalLaps > 0 && (
        <span className="header-lap">
          Lap {currentLap}&thinsp;<span className="total">/ {totalLaps}</span>
        </span>
      )}

      <div className="header-spacer" />

      {/* Mode tabs */}
      <nav className="mode-tabs" aria-label="View mode">
        <button
          className={`mode-tab${mode === 'live' ? ' active' : ''}`}
          onClick={() => onModeChange('live')}
        >
          <span className={`mode-dot${mode === 'live' ? ' live' : ''}`} />
          Live
        </button>
        <button
          className={`mode-tab${mode === 'history' ? ' active' : ''}`}
          onClick={() => onModeChange('history')}
        >
          History
        </button>
        <button
          className={`mode-tab${mode === 'explorer' ? ' active' : ''}`}
          onClick={() => onModeChange('explorer')}
        >
          Explorer
        </button>
      </nav>

      {/* Safety car / red flag banner */}
      {activeSc && (
        <div
          className={`sc-banner ${
            activeSc === 'SC' ? 'sc' : activeSc === 'VSC' ? 'vsc' : 'red'
          }`}
        >
          <span className="sc-banner-dot" />
          {SC_LABEL[activeSc] ?? activeSc}
        </div>
      )}
    </header>
  );
}
