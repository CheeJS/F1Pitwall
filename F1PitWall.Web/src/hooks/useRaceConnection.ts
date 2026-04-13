import { useCallback, useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';
import type {
  RaceState,
  DriverUpdateMessage,
  CarDataMessage,
  SessionStatusMessage,
  SafetyCarMessage,
  ConnectionStatus,
} from '../types';

interface Handlers {
  onFullState: (s: RaceState) => void;
  onDriverUpdate: (u: DriverUpdateMessage) => void;
  onCarData: (d: CarDataMessage) => void;
  onSessionStatus: (s: SessionStatusMessage) => void;
  onSafetyCar: (s: SafetyCarMessage) => void;
  onConnectionChange: (s: ConnectionStatus) => void;
}

interface Connection {
  /** Manually retry when the connection has failed. */
  reconnect: () => void;
}

// Initial-connect retry delays (ms). Post-connect drops are handled by
// withAutomaticReconnect below.
const INITIAL_RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function useRaceConnection(handlers: Handlers): Connection {
  const h = useRef(handlers);
  h.current = handlers;
  const [attempt, setAttempt] = useState(0);

  const reconnect = useCallback(() => { setAttempt(a => a + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    const hub = new signalR.HubConnectionBuilder()
      .withUrl(`${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/hubs/timing`)
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    hub.on('ReceiveFullState',        (s: RaceState)              => h.current.onFullState(s));
    hub.on('ReceiveDriverUpdate',     (u: DriverUpdateMessage)    => h.current.onDriverUpdate(u));
    hub.on('ReceiveCarData',          (d: CarDataMessage)         => h.current.onCarData(d));
    hub.on('ReceiveSessionStatus',    (s: SessionStatusMessage)   => h.current.onSessionStatus(s));
    hub.on('ReceiveSafetyCarStatus',  (s: SafetyCarMessage)       => h.current.onSafetyCar(s));

    hub.onreconnecting(() => h.current.onConnectionChange('reconnecting'));
    hub.onreconnected (() => h.current.onConnectionChange('connected'));
    hub.onclose       (() => h.current.onConnectionChange('disconnected'));

    // Initial connect loop with bounded backoff. Aborts on unmount.
    const connect = async () => {
      for (let i = 0; i < INITIAL_RETRY_DELAYS.length; i++) {
        if (cancelled) return;
        h.current.onConnectionChange(i === 0 ? 'connecting' : 'reconnecting');
        try {
          await hub.start();
          if (!cancelled) h.current.onConnectionChange('connected');
          return;
        } catch {
          if (cancelled) return;
          await new Promise(r => setTimeout(r, INITIAL_RETRY_DELAYS[i]));
        }
      }
      if (!cancelled) h.current.onConnectionChange('disconnected');
    };
    void connect();

    return () => { cancelled = true; void hub.stop(); };
  }, [attempt]);

  return { reconnect };
}
