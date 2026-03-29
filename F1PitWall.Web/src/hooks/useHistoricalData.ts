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
        if (err.name !== 'AbortError') setError(err.message as string);
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
        if (err.name !== 'AbortError') setError(err.message as string);
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
