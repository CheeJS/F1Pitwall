import { useMemo } from 'react';
import type { F1Session } from '../types';

const YEARS = [2023, 2024, 2025, 2026];

// ── Session type label ─────────────────────────────────────
function sessionBadge(type: string): string {
  switch (type.toLowerCase()) {
    case 'race':             return 'R';
    case 'qualifying':       return 'Q';
    case 'sprint':           return 'S';
    case 'sprint qualifying':
    case 'sprint shootout':  return 'SQ';
    case 'practice':         return 'P';
    default:
      // "Practice 1", "Practice 2" etc.
      if (type.startsWith('Practice')) return type.replace('Practice ', 'P');
      return type.slice(0, 2).toUpperCase();
  }
}

function badgeClass(type: string): string {
  switch (type.toLowerCase()) {
    case 'race':    return 'badge-race';
    case 'sprint':  return 'badge-sprint';
    case 'qualifying': return 'badge-qualifying';
    default:        return 'badge-practice';
  }
}

interface MeetingGroup {
  meetingKey: number;
  meetingName: string;
  circuitShortName: string;
  dateStart: string;
  sessions: F1Session[];
}

interface Props {
  year: number;
  setYear: (y: number) => void;
  sessions: F1Session[];
  selectedSession: F1Session | null;
  onSelectSession: (s: F1Session) => void;
  loading: boolean;
  error: string | null;
}

export function SessionBrowser({
  year,
  setYear,
  sessions,
  selectedSession,
  onSelectSession,
  loading,
  error,
}: Props) {
  // Group sessions by meeting, sorted most-recent first
  const meetings = useMemo<MeetingGroup[]>(() => {
    const map = new Map<number, MeetingGroup>();

    for (const s of sessions) {
      if (!map.has(s.meetingKey)) {
        map.set(s.meetingKey, {
          meetingKey: s.meetingKey,
          meetingName: s.meetingName,
          circuitShortName: s.circuitShortName,
          dateStart: s.dateStart,
          sessions: [],
        });
      }
      map.get(s.meetingKey)!.sessions.push(s);
    }

    // Sort each meeting's sessions by dateStart ASC (P1 → P2 → P3 → Q → R)
    for (const meeting of map.values()) {
      meeting.sessions.sort((a, b) => a.dateStart.localeCompare(b.dateStart));
    }

    // Sort meetings by newest first
    return Array.from(map.values()).sort((a, b) => {
      const aDate = a.sessions[a.sessions.length - 1]?.dateStart ?? '';
      const bDate = b.sessions[b.sessions.length - 1]?.dateStart ?? '';
      return bDate.localeCompare(aDate);
    });
  }, [sessions]);

  return (
    <aside className="session-browser">
      {/* Year tabs */}
      <nav className="year-nav" aria-label="Year selector">
        {YEARS.map(y => (
          <button
            key={y}
            className={`year-btn${y === year ? ' active' : ''}`}
            onClick={() => setYear(y)}
          >
            {y}
          </button>
        ))}
      </nav>

      {/* Session list */}
      <div className="session-list" role="list">
        {loading && (
          <div className="session-loading">
            <span className="spinner" />
            Loading sessions…
          </div>
        )}

        {!loading && error && (
          <div className="session-empty session-error">
            <span>⚠ {error}</span>
          </div>
        )}

        {!loading && !error && meetings.length === 0 && (
          <div className="session-empty">No sessions found</div>
        )}

        {meetings.map(meeting => (
          <div key={meeting.meetingKey} className="meeting-group" role="group">
            <div className="meeting-header">
              <span className="meeting-circuit">{meeting.circuitShortName}</span>
              <span className="meeting-gp">{meeting.meetingName.replace(/ Grand Prix$/, ' GP').replace(/ Grand Prix /i, ' GP ')}</span>
              <span className="meeting-date">
                {new Date(meeting.dateStart).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            {meeting.sessions.map(s => (
              <button
                key={s.sessionKey}
                role="listitem"
                className={`session-item${selectedSession?.sessionKey === s.sessionKey ? ' selected' : ''}`}
                onClick={() => onSelectSession(s)}
              >
                <span className={`session-type-badge ${badgeClass(s.sessionType)}`}>
                  {sessionBadge(s.sessionType)}
                </span>
                <span className="session-item-name">{s.sessionName}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
