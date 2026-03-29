import type { ConnectionStatus } from '../types';
import { timeAgo } from '../utils/formatters';

interface Props {
  connectionStatus: ConnectionStatus;
  lastUpdateTime: number | null;
  driverCount: number;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

export function StatusBar({ connectionStatus, lastUpdateTime, driverCount }: Props) {
  return (
    <footer className="status-bar">
      {/* Connection indicator */}
      <div className="status-bar-item">
        <span className={`connection-dot ${connectionStatus}`} />
        {STATUS_LABEL[connectionStatus]}
      </div>

      {/* Driver count */}
      {driverCount > 0 && (
        <div className="status-bar-item">{driverCount} drivers</div>
      )}

      <div className="status-bar-spacer" />

      {/* Last update */}
      {lastUpdateTime !== null && (
        <div className="status-bar-item">
          Updated {timeAgo(lastUpdateTime)}
        </div>
      )}

      {/* Backend hint */}
      <div className="status-bar-item" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
        /hubs/timing
      </div>
    </footer>
  );
}
