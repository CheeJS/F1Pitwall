import { useState } from 'react';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { TrackMap } from './TrackMap';
import {
  ReplayTimingTower, ReplayControls, RaceMessages, DriverDetailPanel,
} from './RaceReplay';
import { COMPOUND_STYLE } from '../utils/replayUtils';
import type { OF1Weather } from '../api/openf1Direct';

// ── Weather display ──────────────────────────────────────

function WeatherBar({ weather }: { weather: OF1Weather | null }) {
  if (!weather) return null;
  return (
    <div className="dash-weather">
      <span className="dash-weather-item" title="Air temperature">
        <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 1v7M4 8a2.5 2.5 0 105 0" />
        </svg>
        {weather.air_temperature.toFixed(0)}°
      </span>
      <span className="dash-weather-item" title="Track temperature">
        <svg viewBox="0 0 12 12" width={10} height={10} fill="currentColor"><rect x="2" y="8" width="8" height="3" rx="1" opacity="0.6"/></svg>
        {weather.track_temperature.toFixed(0)}°
      </span>
      <span className="dash-weather-item" title="Humidity">
        {weather.humidity.toFixed(0)}%
      </span>
      <span className="dash-weather-item" title={`Wind ${weather.wind_direction}°`}>
        <svg viewBox="0 0 12 12" width={10} height={10} fill="currentColor" style={{ transform: `rotate(${weather.wind_direction}deg)` }}>
          <path d="M6 1l3 10H3z" opacity="0.6"/>
        </svg>
        {weather.wind_speed.toFixed(0)} m/s
      </span>
      {weather.rainfall > 0 && (
        <span className="dash-weather-item dash-weather-rain" title="Rainfall">
          Rain
        </span>
      )}
    </div>
  );
}

// ── Dashboard Header ─────────────────────────────────────

function DashboardHeader({
  circuitName, sessionName, currentLap, totalLaps, weather,
}: {
  circuitName: string;
  sessionName: string;
  currentLap: number;
  totalLaps: number;
  weather: OF1Weather | null;
}) {
  return (
    <header className="dash-header">
      <div className="dash-header-left">
        <span className="dash-header-circuit">{circuitName}</span>
        <span className="dash-header-sep">·</span>
        <span className="dash-header-session">{sessionName}</span>
        {totalLaps > 0 && (
          <>
            <span className="dash-header-sep">·</span>
            <span className="dash-header-lap">Lap {currentLap}/{totalLaps}</span>
          </>
        )}
      </div>
      <WeatherBar weather={weather} />
    </header>
  );
}

// ── Strategy sidebar (mini stints for all drivers) ───────

function StrategyColumn({
  towerRows, stintIdx,
}: {
  towerRows: { driverNumber: number; abbreviation: string; teamColour: string; currentLap: number }[];
  stintIdx: Map<number, import('../api/openf1Direct').OF1Stint[]>;
}) {
  return (
    <div className="dash-strategy">
      <div className="dash-strategy-title">Strategy</div>
      {towerRows.slice(0, 20).map(row => {
        const driverStints = stintIdx.get(row.driverNumber) ?? [];
        const usedStints = driverStints.filter(s => s.lap_start <= (row.currentLap || Infinity));
        return (
          <div key={row.driverNumber} className="dash-strategy-row">
            <span className="dash-strategy-abbr" style={{ color: `#${row.teamColour}` }}>{row.abbreviation}</span>
            <div className="dash-strategy-stints">
              {usedStints.map(s => {
                const cs = COMPOUND_STYLE[s.compound] ?? null;
                const lapsOnTyre = Math.min(row.currentLap, s.lap_end ?? row.currentLap) - s.lap_start + 1;
                return (
                  <span
                    key={s.stint_number}
                    className="dash-strategy-badge"
                    style={cs ? { background: cs.bg, color: cs.fg } : undefined}
                    title={`${s.compound} L${s.lap_start}-${s.lap_end ?? '?'} (${lapsOnTyre} laps)`}
                  >
                    {cs?.abbr ?? s.compound.charAt(0)}{lapsOnTyre > 0 ? lapsOnTyre : ''}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────

interface Props {
  sessionKey: number;
}

export function ReplayDashboard({ sessionKey }: Props) {
  const [highlightedDriver, setHighlightedDriver] = useState<number | null>(null);

  const engine = useReplayEngine({ sessionKey, highlightedDriver });
  const {
    selectedSession, drivers, laps, raceControl, stintIdx,
    loading, loadingCarData, error,
    rs, minTime, maxTime, carDataMap,
    towerRows, totalLaps, highlightedCarData,
    isQualifying, lapMarkers,
    driverMarkers, trackPoints, circuitInfo, currentWeather,
    play, pause, scrub, setSpeed,
  } = engine;

  const leaderLap = towerRows.length > 0 ? towerRows[0].currentLap : 0;

  if (loading) {
    return (
      <div className="dash-root">
        <div className="dash-loading">
          <span className="spinner" />
          Loading session data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-root">
        <div className="dash-error">{error}</div>
      </div>
    );
  }

  if (!selectedSession) {
    return (
      <div className="dash-root">
        <div className="dash-loading">Loading session…</div>
      </div>
    );
  }

  return (
    <div className="dash-root">
      <DashboardHeader
        circuitName={selectedSession.circuit_short_name}
        sessionName={selectedSession.session_name}
        currentLap={leaderLap}
        totalLaps={totalLaps}
        weather={currentWeather}
      />

      <div className="dash-body">
        {/* Left: Timing Tower */}
        <div className="dash-tower">
          <ReplayTimingTower
            rows={towerRows}
            highlighted={highlightedDriver}
            onSelectDriver={setHighlightedDriver}
            totalLaps={totalLaps}
            isQualifying={isQualifying}
          />
        </div>

        {/* Center: Track map + Race control */}
        <div className="dash-center">
          <div className="dash-map">
            <TrackMap
              markers={driverMarkers}
              highlighted={highlightedDriver}
              onSelectDriver={setHighlightedDriver}
              trackPoints={trackPoints ?? undefined}
              circuitInfo={circuitInfo ?? undefined}
            />
          </div>
          <div className="dash-feed">
            <RaceMessages messages={raceControl} currentTime={rs.currentTime} />
            <StrategyColumn towerRows={towerRows} stintIdx={stintIdx} />
          </div>
        </div>

        {/* Right: Driver detail */}
        <div className="dash-detail">
          {highlightedDriver !== null ? (
            <DriverDetailPanel
              highlightedDriver={highlightedDriver}
              drivers={drivers}
              carDataMap={carDataMap}
              loadingCarData={loadingCarData}
              stintIdx={stintIdx}
              laps={laps}
              towerRows={towerRows}
              rs={rs}
              onSelectDriver={setHighlightedDriver}
            />
          ) : (
            <div className="dash-detail-empty">
              Click a driver to see telemetry
            </div>
          )}
        </div>
      </div>

      <ReplayControls
        rs={rs}
        minTime={minTime}
        maxTime={maxTime}
        onPlay={play}
        onPause={pause}
        onScrub={scrub}
        onSpeed={setSpeed}
        lapMarkers={lapMarkers}
      />
    </div>
  );
}
