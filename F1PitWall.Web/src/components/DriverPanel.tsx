import type { DriverState } from '../types';
import { getTyreStyle, teamColor } from '../utils/formatters';

interface Props {
  driver: DriverState | null;
  onClose: () => void;
}

export function DriverPanel({ driver, onClose }: Props) {
  if (!driver) {
    return (
      <div className="driver-panel">
        <div className="empty-state">
          <p className="empty-state-title">No driver selected</p>
        </div>
      </div>
    );
  }

  const colour = teamColor(driver.teamColour);
  const tyre = getTyreStyle(driver.tyreCompound);

  return (
    <div
      className="driver-panel"
      aria-label={`Driver detail: ${driver.abbreviation}`}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div className="driver-panel-header">
        <div
          className="panel-team-swatch"
          style={{ background: colour }}
          aria-hidden="true"
        />
        <div>
          <div className="panel-driver-num">{driver.driverNumber}</div>
          <div className="panel-driver-abbr">{driver.abbreviation}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="panel-position">
            P{driver.position > 0 ? driver.position : '—'}
          </div>
          <div className="panel-position-label">position</div>
        </div>
        <button
          className="panel-close-btn"
          onClick={onClose}
          aria-label="Close driver panel"
        >
          ✕
        </button>
      </div>

      {/* ── Telemetry ──────────────────────────────────── */}
      <div className="panel-section">
        <p className="panel-section-title">Telemetry</p>

        <TelemetryBar
          label="Speed"
          value={driver.speed}
          max={360}
          unit="km/h"
          fillColor="var(--blue)"
        />
        <TelemetryBar
          label="Throttle"
          value={driver.throttle}
          max={100}
          unit="%"
          fillColor="var(--green)"
        />
        <TelemetryBar
          label="Brake"
          value={driver.brake}
          max={100}
          unit="%"
          fillColor="var(--red)"
        />

        {/* Gear + DRS */}
        <div className="telemetry-row" style={{ marginTop: 12 }}>
          <span className="telemetry-label">Gear</span>
          <div className="gear-display">
            <div className="gear-box">
              {driver.gear > 0 ? driver.gear : 'N'}
            </div>
            <span
              className={`drs-badge ${driver.drsOpen ? 'open' : 'closed'}`}
              aria-label={driver.drsOpen ? 'DRS open' : 'DRS closed'}
            >
              DRS {driver.drsOpen ? 'Open' : 'Closed'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Tyre ───────────────────────────────────────── */}
      <div className="panel-section">
        <p className="panel-section-title">Tyre</p>
        <div className="tyre-panel">
          <div
            className="tyre-compound-large"
            style={{ background: tyre.bg, color: tyre.color }}
            aria-label={`Compound: ${driver.tyreCompound ?? 'Unknown'}`}
          >
            {tyre.label}
          </div>
          <div className="tyre-meta">
            <div className="tyre-meta-row">
              <span className="tyre-meta-label">Cmpd</span>
              <span className="tyre-meta-value">
                {driver.tyreCompound ?? '—'}
              </span>
            </div>
            <div className="tyre-meta-row">
              <span className="tyre-meta-label">Age</span>
              <span className="tyre-meta-value">
                {driver.tyreAge > 0 ? `${driver.tyreAge} laps` : '—'}
              </span>
            </div>
            <div className="tyre-meta-row">
              <span className="tyre-meta-label">Stops</span>
              <span className="tyre-meta-value">{driver.pitStopCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Timing ─────────────────────────────────────── */}
      <div className="panel-section">
        <p className="panel-section-title">Timing</p>
        <div className="timing-stats">
          <TimingStat label="Last lap" value={driver.lastLapTime} />
          <TimingStat label="Gap" value={driver.gapToLeader} />
          <TimingStat label="Interval" value={driver.interval} />
          <TimingStat
            label="Lap"
            value={driver.currentLap > 0 ? String(driver.currentLap) : null}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

interface TelemetryBarProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  fillColor: string;
}

function TelemetryBar({ label, value, max, unit, fillColor }: TelemetryBarProps) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="telemetry-row">
      <span className="telemetry-label">{label}</span>
      <div
        className="telemetry-bar-track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${label}: ${value} ${unit}`}
      >
        <div
          className="telemetry-bar-fill"
          style={{ width: `${pct}%`, background: fillColor }}
        />
      </div>
      <span className="telemetry-value">
        {value} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{unit}</span>
      </span>
    </div>
  );
}

interface TimingStatProps {
  label: string;
  value: string | null | undefined;
}

function TimingStat({ label, value }: TimingStatProps) {
  return (
    <div className="timing-stat">
      <span className="timing-stat-label">{label}</span>
      <span className={`timing-stat-value ${!value ? 'empty' : ''}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}
