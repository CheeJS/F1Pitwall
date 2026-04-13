import { type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  sessionLabel: string;
  loading: boolean;
  error: string | null;
  children: ReactNode;
  className?: string;
}

/** Shared chrome for popup windows — session label header, a loading spinner,
 *  an error fallback, and an ErrorBoundary so one crash doesn't blank the popup. */
export function PopupFrame({ sessionLabel, loading, error, children, className }: Props) {
  return (
    <div className={`popup-root ${className ?? ''}`}>
      <div className="popup-session-label">{sessionLabel}</div>
      {error ? (
        <div className="popup-empty" role="alert">
          <strong>Could not load session.</strong>
          <span className="popup-empty-msg">{error}</span>
        </div>
      ) : loading ? (
        <div className="popup-empty">
          <span className="spinner" />
          Loading session data…
        </div>
      ) : (
        <ErrorBoundary fallbackTitle="Popup crashed">
          {children}
        </ErrorBoundary>
      )}
    </div>
  );
}
