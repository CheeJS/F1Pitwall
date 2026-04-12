import { useState, useEffect } from 'react';
import type { F1Session, DriverClassification } from '../types';
import { fetchSessions, fetchClassification } from '../api/openf1Api';

interface HistoricalData {
  year: number;
  setYear: (y: number) => void;
  sessions: F1Session[];
  selectedSession: F1Session | null;
  setSelectedSession: (s: F1Session | null) => void;
  classification: DriverClassification[] | null;
  loadingSessions: boolean;
  loadingClassification: boolean;
  error: string | null;
}

function humanizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('429')) return 'Too many requests — please wait a moment.';
  if (msg.includes('500') || msg.includes('503')) return 'Data service unavailable. Try again shortly.';
  if (msg.includes('401') || msg.includes('403')) return 'Access denied. Check API credentials.';
  if (msg.includes('Network') || msg.includes('fetch')) return 'Network error. Check your connection.';
  return 'Failed to load data. Please try again.';
}

export function useHistoricalData(defaultYear = 2025): HistoricalData {
  const [year, setYear] = useState(defaultYear);
  const [sessions, setSessions] = useState<F1Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<F1Session | null>(null);
  const [classification, setClassification] = useState<DriverClassification[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingClassification, setLoadingClassification] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch sessions whenever year changes ───────────────
  useEffect(() => {
    const ctrl = new AbortController();
    setLoadingSessions(true);
    setError(null);
    setSessions([]);
    setSelectedSession(null);
    setClassification(null);

    fetchSessions(year, ctrl.signal)
      .then(data => setSessions(data))
      .catch(err => {
        if (err.name !== 'AbortError') setError(humanizeError(err));
      })
      .finally(() => setLoadingSessions(false));

    return () => ctrl.abort();
  }, [year]);

  // ── Fetch classification when session changes ──────────
  useEffect(() => {
    if (!selectedSession) {
      setClassification(null);
      return;
    }

    const ctrl = new AbortController();
    setLoadingClassification(true);
    setError(null);
    setClassification(null);

    fetchClassification(selectedSession.sessionKey, ctrl.signal)
      .then(data => setClassification(data))
      .catch(err => {
        if (err.name !== 'AbortError') setError(humanizeError(err));
      })
      .finally(() => setLoadingClassification(false));

    return () => ctrl.abort();
  }, [selectedSession]);

  return {
    year,
    setYear,
    sessions,
    selectedSession,
    setSelectedSession,
    classification,
    loadingSessions,
    loadingClassification,
    error,
  };
}
