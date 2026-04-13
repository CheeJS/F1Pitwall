import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Text/JSX shown above the reset button */
  fallbackTitle?: string;
  /** Optional reset handler; defaults to clearing the boundary's internal state. */
  onReset?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render-time errors so a single broken panel doesn't crash the whole
 *  replay UI. Logs to the console; in production this is where you'd wire
 *  up Sentry / Application Insights. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-inner">
          <h2 className="error-boundary-title">
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p className="error-boundary-msg">{error.message}</p>
          <button className="error-boundary-btn" onClick={this.reset}>
            Reload this view
          </button>
        </div>
      </div>
    );
  }
}
