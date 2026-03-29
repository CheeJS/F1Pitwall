import { useState, useMemo } from 'react';

export type EndpointId =
  | 'car_data'
  | 'drivers'
  | 'drivers_championship'
  | 'team_championship'
  | 'intervals'
  | 'laps'
  | 'location'
  | 'meetings'
  | 'pit'
  | 'position'
  | 'race_control'
  | 'sessions'
  | 'session_result'
  | 'starting_grid'
  | 'stints'
  | 'team_radio'
  | 'weather';

export interface EndpointMeta {
  id: EndpointId;
  label: string;
  description: string;
  group: string;
  realtimeCapable: boolean;
}

export const ENDPOINTS: EndpointMeta[] = [
  // Telemetry
  { id: 'car_data',       label: 'Car data',              group: 'Telemetry',    description: 'High-freq RPM, speed, throttle, brake, gear, DRS', realtimeCapable: true  },
  { id: 'location',       label: 'Location',              group: 'Telemetry',    description: 'Driver X/Y/Z coordinates at high frequency',       realtimeCapable: true  },
  { id: 'position',       label: 'Position',              group: 'Telemetry',    description: 'Race position per driver over time',                realtimeCapable: true  },
  // Session
  { id: 'sessions',       label: 'Sessions',              group: 'Session',      description: 'Session metadata: type, dates, circuit, year',      realtimeCapable: false },
  { id: 'meetings',       label: 'Meetings',              group: 'Session',      description: 'Grand Prix meeting info and location data',         realtimeCapable: false },
  { id: 'weather',        label: 'Weather',               group: 'Session',      description: 'Air/track temperature, wind, humidity, rainfall',    realtimeCapable: true  },
  { id: 'race_control',   label: 'Race control',          group: 'Session',      description: 'Flags, SC, VSC, penalties, DRS enabled/disabled',   realtimeCapable: true  },
  // Drivers
  { id: 'drivers',        label: 'Drivers',               group: 'Drivers',      description: 'Driver profiles: name, team, headshot, number',     realtimeCapable: false },
  { id: 'intervals',      label: 'Intervals',             group: 'Drivers',      description: 'Gap to leader and interval to car ahead',           realtimeCapable: true  },
  { id: 'stints',         label: 'Stints',                group: 'Drivers',      description: 'Tyre compound, stint start/end laps', realtimeCapable: false },
  { id: 'pit',            label: 'Pit',                   group: 'Drivers',      description: 'Pit stop entries, lap number, duration',             realtimeCapable: true  },
  { id: 'team_radio',     label: 'Team radio',            group: 'Drivers',      description: 'Audio clips of team radio during sessions',          realtimeCapable: true  },
  // Lap data
  { id: 'laps',           label: 'Laps',                  group: 'Lap data',     description: 'Sector times, speeds, overall lap duration',         realtimeCapable: true  },
  // Results
  { id: 'session_result', label: 'Session result',        group: 'Results',      description: 'Final finishing positions per session',              realtimeCapable: false },
  { id: 'starting_grid',  label: 'Starting grid',         group: 'Results',      description: 'Grid positions for race and sprint sessions',        realtimeCapable: false },
  // Championship
  { id: 'drivers_championship', label: 'Drivers champ.', group: 'Championship', description: 'Drivers championship standings (beta)',              realtimeCapable: false },
  { id: 'team_championship',    label: 'Teams champ.',   group: 'Championship', description: 'Constructors championship standings (beta)',          realtimeCapable: false },
];

const GROUPS = ['Telemetry', 'Session', 'Drivers', 'Lap data', 'Results', 'Championship'] as const;

interface Props {
  active: EndpointId;
  onChange: (id: EndpointId) => void;
}

export function ExplorerSidebar({ active, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return ENDPOINTS;
    return ENDPOINTS.filter(
      e => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.id.includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, EndpointMeta[]>();
    for (const g of GROUPS) map.set(g, []);
    for (const e of filtered) {
      const arr = map.get(e.group);
      if (arr) arr.push(e);
    }
    return map;
  }, [filtered]);

  const toggleGroup = (g: string) => {
    setCollapsed(p => {
      const n = new Set(p);
      if (n.has(g)) n.delete(g); else n.add(g);
      return n;
    });
  };

  return (
    <aside className="exp-sidebar">
      <div className="exp-search-wrap">
        <svg className="exp-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10 10 L14 14" strokeLinecap="round" />
        </svg>
        <input
          className="exp-search"
          placeholder="Filter endpoints…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Filter endpoints"
        />
        {query && (
          <button className="exp-search-clear" onClick={() => setQuery('')} aria-label="Clear">
            ×
          </button>
        )}
      </div>

      <nav className="exp-nav">
        {GROUPS.map(group => {
          const items = grouped.get(group) ?? [];
          if (items.length === 0) return null;
          const isCollapsed = collapsed.has(group);
          return (
            <div key={group} className="exp-group">
              <button
                className="exp-group-header"
                onClick={() => toggleGroup(group)}
                aria-expanded={!isCollapsed}
              >
                <svg
                  className={`exp-chevron${isCollapsed ? '' : ' open'}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M3 4.5 L6 7.5 L9 4.5" />
                </svg>
                <span className="exp-group-label">{group}</span>
                <span className="exp-group-count">{items.length}</span>
              </button>

              {!isCollapsed && (
                <ul className="exp-group-items">
                  {items.map(ep => (
                    <li key={ep.id}>
                      <button
                        className={`exp-nav-item${active === ep.id ? ' active' : ''}`}
                        onClick={() => onChange(ep.id)}
                        title={ep.description}
                      >
                        <span className="exp-nav-label">{ep.label}</span>
                        {ep.realtimeCapable && (
                          <span className="exp-rt-dot" title="Real-time capable" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
