import { useMemo, useState } from 'react';
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

function isPractice(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'practice' || t.startsWith('practice ');
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
  const [collapsed, setCollapsed] = useState(false);

  // Group sessions by meeting, sorted most-recent first
  const meetings = useMemo<MeetingGroup[]>(() => {
    const map = new Map<number, MeetingGroup>();

    const filtered = sessions.filter(s => !isPractice(s.sessionType));

    for (const s of filtered) {
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

    // Sort meetings oldest first (round 1 at top, most recent at bottom)
    return Array.from(map.values()).sort((a, b) => {
      const aDate = a.sessions[0]?.dateStart ?? '';
      const bDate = b.sessions[0]?.dateStart ?? '';
      return aDate.localeCompare(bDate);
    });
  }, [sessions]);

  return (
    <aside className={`session-browser${collapsed ? ' collapsed' : ''}`}>
      {/* Collapse toggle */}
      <button
        className="session-browser-collapse-btn"
        onClick={() => setCollapsed(p => !p)}
        aria-label={collapsed ? 'Expand session browser' : 'Collapse session browser'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {!collapsed && <span>Sessions</span>}
        <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2L3 5l4 3" />
        </svg>
      </button>

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

        {meetings.map((meeting, idx) => (
          <div
            key={meeting.meetingKey}
            className="meeting-group"
            role="group"
            data-idx={idx}
            style={{ animationDelay: `${Math.min(idx * 40, 320)}ms` }}
          >
            <div className="meeting-header">
              <span className="meeting-circuit">{meeting.circuitShortName}</span>
              <span className="meeting-gp">{meeting.meetingName.replace(/ Grand Prix$/, ' GP').replace(/ Grand Prix /i, ' GP ')}</span>
              <span className="meeting-date">
                {new Date(meeting.dateStart).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            {meeting.sessions.map(s => (
              <div key={s.sessionKey} className="session-item-row">
                <button
                  role="listitem"
                  className={`session-item${selectedSession?.sessionKey === s.sessionKey ? ' selected' : ''}`}
                  onClick={() => onSelectSession(s)}
                >
                  <span className={`session-type-badge ${badgeClass(s.sessionType)}`}>
                    {sessionBadge(s.sessionType)}
                  </span>
                  <span className="session-item-name">{s.sessionName}</span>
                </button>
                <button
                  className="session-popout-btn"
                  aria-label={`Open ${s.sessionName} replay in new window`}
                  title="Open replay in new window"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(
                      `/#/replay/${s.sessionKey}`,
                      'f1-replay',
                      'width=1600,height=900,menubar=no,toolbar=no',
                    );
                  }}
                >
                  <svg viewBox="0 0 14 14" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 1h4v4M5 9L13 1M8 3H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
