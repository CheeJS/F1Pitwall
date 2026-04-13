import { useState, useEffect } from 'react';
import { OF1, type OF1ChampionshipDriver, type OF1ChampionshipTeam, type OF1Driver, type OF1Session, type OF1SessionResult } from '../api/openf1Direct';

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

/** Try the dedicated championship endpoint first; fall back to computing from race results. */
async function loadStandings(year: number, signal: AbortSignal): Promise<{
  year: number;
  drivers: DriverStanding[];
  teams: TeamStanding[];
}> {
  for (const y of [year, year - 1]) {
    const race = await findLastRaceSession(y, signal);
    if (!race) continue;

    const [chDrivers, chTeams, driverInfo] = await Promise.all([
      OF1.driverChampionship({ session_key: race.session_key }, signal),
      OF1.teamChampionship({ session_key: race.session_key }, signal),
      OF1.drivers({ session_key: race.session_key }, signal),
    ]);

    const driverMap = new Map<number, OF1Driver>(driverInfo.map(d => [d.driver_number, d]));
    const teamColourMap = new Map<string, string>();
    for (const d of driverInfo) {
      if (!teamColourMap.has(d.team_name)) teamColourMap.set(d.team_name, d.team_colour);
    }

    // Championship endpoint has data — use it directly
    if ((chDrivers as OF1ChampionshipDriver[]).length > 0) {
      const drivers: DriverStanding[] = (chDrivers as OF1ChampionshipDriver[])
        .sort((a, b) => a.position_current - b.position_current)
        .map(c => {
          const d = driverMap.get(c.driver_number);
          return {
            position: c.position_current, driverNumber: c.driver_number,
            acronym: d?.name_acronym ?? `#${c.driver_number}`,
            name: d?.broadcast_name ?? `Driver ${c.driver_number}`,
            teamName: d?.team_name ?? '—', teamColour: d?.team_colour ?? '666666',
            points: c.points_current, pointsStart: c.points_start,
          };
        });
      const teams: TeamStanding[] = (chTeams as OF1ChampionshipTeam[])
        .sort((a, b) => a.position_current - b.position_current)
        .map(c => ({
          position: c.position_current, teamName: c.team_name,
          teamColour: teamColourMap.get(c.team_name) ?? '666666',
          points: c.points_current, pointsStart: c.points_start,
        }));
      return { year: y, drivers, teams };
    }

    // Championship endpoint empty — compute from session_result across all completed rounds
    const allSessions = await OF1.sessions({ year: y }, signal);
    const now = Date.now();
    const completedRounds = allSessions.filter(
      s => (s.session_type === 'Race' || s.session_type === 'Sprint')
        && new Date(s.date_end).getTime() < now,
    );
    if (!completedRounds.length) continue;

    const allResults: OF1SessionResult[][] = await Promise.all(
      completedRounds.map(s => OF1.sessionResults({ session_key: s.session_key }, signal) as Promise<OF1SessionResult[]>),
    );

    // Sum points per driver and per team
    const driverPts = new Map<number, number>();
    const teamPts   = new Map<string, number>();
    for (const results of allResults) {
      for (const r of results) {
        if (r.dsq) continue;
        driverPts.set(r.driver_number, (driverPts.get(r.driver_number) ?? 0) + (r.points ?? 0));
        const d = driverMap.get(r.driver_number);
        if (d) teamPts.set(d.team_name, (teamPts.get(d.team_name) ?? 0) + (r.points ?? 0));
      }
    }

    if (!driverPts.size) continue;

    const drivers: DriverStanding[] = [...driverPts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([dn, pts], i) => {
        const d = driverMap.get(dn);
        return {
          position: i + 1, driverNumber: dn,
          acronym: d?.name_acronym ?? `#${dn}`,
          name: d?.broadcast_name ?? `Driver ${dn}`,
          teamName: d?.team_name ?? '—', teamColour: d?.team_colour ?? '666666',
          points: pts, pointsStart: 0,
        };
      });

    const teams: TeamStanding[] = [...teamPts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([teamName, pts], i) => ({
        position: i + 1, teamName,
        teamColour: teamColourMap.get(teamName) ?? '666666',
        points: pts, pointsStart: 0,
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
