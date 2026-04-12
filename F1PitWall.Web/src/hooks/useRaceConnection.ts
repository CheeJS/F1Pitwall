import { useEffect, useRef } from 'react';
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

export function useRaceConnection(handlers: Handlers): void {
  // Keep handlers in a ref so the effect never needs to re-run when they change
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const hub = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/timing')
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    hub.on('ReceiveFullState', (s: RaceState) => h.current.onFullState(s));
    hub.on('ReceiveDriverUpdate', (u: DriverUpdateMessage) => h.current.onDriverUpdate(u));
    hub.on('ReceiveCarData', (d: CarDataMessage) => h.current.onCarData(d));
    hub.on('ReceiveSessionStatus', (s: SessionStatusMessage) => h.current.onSessionStatus(s));
    hub.on('ReceiveSafetyCarStatus', (s: SafetyCarMessage) => h.current.onSafetyCar(s));

    hub.onreconnecting(() => h.current.onConnectionChange('reconnecting'));
    hub.onreconnected(() => h.current.onConnectionChange('connected'));
    hub.onclose(() => h.current.onConnectionChange('disconnected'));

    h.current.onConnectionChange('connecting');
    hub.start()
      .then(() => h.current.onConnectionChange('connected'))
      .catch(() => h.current.onConnectionChange('disconnected'));

    return () => { hub.stop(); };
  }, []); // stable — runs once
}
