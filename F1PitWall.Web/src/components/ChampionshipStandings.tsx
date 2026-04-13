import { useState, useEffect } from 'react';
import { OF1, type OF1ChampionshipDriver, type OF1ChampionshipTeam, type OF1Driver, type OF1Session } from '../api/openf1Direct';

// ── Enriched types (joined with driver info) ─────────────

interface DriverStanding {
  position: number;
  driverNumber: number;
  acronym: string;
  name: string;
  teamName: string;
  teamColour: string;
  points: number;
  pointsStart: number;
}

interface TeamStanding {
  position: number;
  teamName: string;
  teamColour: string;
  points: number;
  pointsStart: number;
}

// ── Data fetch ───────────────────────────────────────────

async function findLastRaceSession(year: number, signal: AbortSignal): Promise<OF1Session | null> {
  const sessions = await OF1.sessions({ year }, signal);
  const now = Date.now();
  return [...sessions]
    .filter(s => s.session_type === 'Race' && new Date(s.date_end).getTime() < now)
    .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime())[0] ?? null;
}

async function loadStandings(year: number, signal: AbortSignal): Promise<{
  year: number;
  drivers: DriverStanding[];
  teams: TeamStanding[];
}> {
  // Try current year, then previous year
  for (const y of [year, year - 1]) {
    const race = await findLastRaceSession(y, signal);
    if (!race) continue;

    const [chDrivers, chTeams, driverInfo] = await Promise.all([
      OF1.driverChampionship({ session_key: race.session_key }, signal),
      OF1.teamChampionship({ session_key: race.session_key }, signal),
      OF1.drivers({ session_key: race.session_key }, signal),
    ]);

    if (!chDrivers.length && !chTeams.length) continue;

    // Build lookup: driver_number → driver info
    const driverMap = new Map<number, OF1Driver>(driverInfo.map(d => [d.driver_number, d]));

    // Build lookup: team_name → team_colour (from first driver of that team)
    const teamColourMap = new Map<string, string>();
    for (const d of driverInfo) {
      if (!teamColourMap.has(d.team_name)) {
        teamColourMap.set(d.team_name, d.team_colour);
      }
    }

    const drivers: DriverStanding[] = (chDrivers as OF1ChampionshipDriver[])
      .sort((a, b) => a.position_current - b.position_current)
      .map(c => {
        const d = driverMap.get(c.driver_number);
        return {
          position:     c.position_current,
          driverNumber: c.driver_number,
          acronym:      d?.name_acronym    ?? `#${c.driver_number}`,
          name:         d?.broadcast_name  ?? `Driver ${c.driver_number}`,
          teamName:     d?.team_name       ?? '—',
          teamColour:   d?.team_colour     ?? '666666',
          points:       c.points_current,
          pointsStart:  c.points_start,
        };
      });

    const teams: TeamStanding[] = (chTeams as OF1ChampionshipTeam[])
      .sort((a, b) => a.position_current - b.position_current)
      .map(c => ({
        position:    c.position_current,
        teamName:    c.team_name,
        teamColour:  teamColourMap.get(c.team_name) ?? '666666',
        points:      c.points_current,
        pointsStart: c.points_start,
      }));

    return { year: y, drivers, teams };
  }

  return { year, drivers: [], teams: [] };
}

// ── Driver table ─────────────────────────────────────────

function DriverTable({ drivers }: { drivers: DriverStanding[] }) {
  const leader = drivers[0]?.points ?? 0;
  return (
    <div className="champ-table">
      <div className="champ-table-head">
        <span className="champ-th champ-th-pos">P</span>
        <span className="champ-th">Driver</span>
        <span className="champ-th champ-th-pts">PTS</span>
      </div>
      {drivers.map(d => (
        <div key={d.driverNumber} className="champ-row" style={{ borderLeftColor: `#${d.teamColour}` }}>
          <span className="champ-pos">{d.position}</span>
          <span className="champ-driver-info">
            <span className="champ-acronym" style={{ color: `#${d.teamColour}` }}>{d.acronym}</span>
            <span className="champ-fullname">{d.name}</span>
          </span>
          <span className="champ-pts-group">
            <span className="champ-pts">{d.points}</span>
            {d.position > 1 && <span className="champ-deficit">−{leader - d.points}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Team table ───────────────────────────────────────────

function TeamTable({ teams }: { teams: TeamStanding[] }) {
  const leader = teams[0]?.points ?? 0;
  return (
    <div className="champ-table">
      <div className="champ-table-head">
        <span className="champ-th champ-th-pos">P</span>
        <span className="champ-th">Constructor</span>
        <span className="champ-th champ-th-pts">PTS</span>
      </div>
      {teams.map(t => (
        <div key={t.teamName} className="champ-row" style={{ borderLeftColor: `#${t.teamColour}` }}>
          <span className="champ-pos">{t.position}</span>
          <span className="champ-team-name" style={{ color: `#${t.teamColour}` }}>{t.teamName}</span>
          <span className="champ-pts-group">
            <span className="champ-pts">{t.points}</span>
            {t.position > 1 && <span className="champ-deficit">−{leader - t.points}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Export ───────────────────────────────────────────────

export function ChampionshipStandings({ year = 2026 }: { year?: number }) {
  const [drivers,      setDrivers]      = useState<DriverStanding[]>([]);
  const [teams,        setTeams]        = useState<TeamStanding[]>([]);
  const [dataYear,     setDataYear]     = useState<number>(year);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    loadStandings(year, ac.signal)
      .then(({ year: y, drivers, teams }) => { setDrivers(drivers); setTeams(teams); setDataYear(y); setLoading(false); })
      .catch(err => { if ((err as Error).name !== 'AbortError') { setError('Failed to load'); setLoading(false); } });
    return () => ac.abort();
  }, [year]);

  if (loading) return <div className="champ-status" aria-live="polite" aria-busy="true"><span className="spinner" aria-hidden="true" /> Loading standings…</div>;
  if (error)   return <div className="champ-status champ-status--error">{error}</div>;
  if (!drivers.length && !teams.length) return null;

  return (
    <div className="champ-root">
      <div className="champ-columns">
        {drivers.length > 0 && (
          <div className="champ-section">
            <h2 className="champ-section-title">{dataYear} Drivers Championship</h2>
            <DriverTable drivers={drivers} />
          </div>
        )}
        {teams.length > 0 && (
          <div className="champ-section">
            <h2 className="champ-section-title">{dataYear} Constructors Championship</h2>
            <TeamTable teams={teams} />
          </div>
        )}
      </div>
    </div>
  );
}
