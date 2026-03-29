import type { F1Session, DriverClassification } from '../types';

// ── Generic fetch wrapper ─────────────────────────────────
async function apiFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Sessions ──────────────────────────────────────────────

/**
 * GET /api/sessions?year={year}
 * Returns sessions for the given year, ordered newest-first.
 */
export const fetchSessions = (year: number, signal?: AbortSignal) =>
  apiFetch<F1Session[]>(`/api/sessions?year=${year}`, signal);

/**
 * GET /api/sessions/{sessionKey}/classification
 * Returns final classification: position, best lap, total laps per driver.
 */
export const fetchClassification = (sessionKey: number, signal?: AbortSignal) =>
  apiFetch<DriverClassification[]>(`/api/sessions/${sessionKey}/classification`, signal);
