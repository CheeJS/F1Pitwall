// ── Domain model ─────────────────────────────────────────
export interface DriverState {
  driverNumber: number;
  abbreviation: string;
  teamColour: string; // hex without '#', e.g. "00D2BE"
  position: number;
  lastLapTime: string | null;
  gapToLeader: string | null;
  interval: string | null;
  currentLap: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  drsOpen: boolean;
  tyreCompound: string | null;
  tyreAge: number;
  pitStopCount: number;
  inPit: boolean;
  lastUpdated: string;
}

export interface RaceState {
  sessionType: 'Practice' | 'Qualifying' | 'Sprint' | 'Race';
  status: 'Inactive' | 'Started' | 'Finished' | 'Aborted';
  safetyCarStatus: string | null;
  totalLaps: number;
  drivers: Record<string, DriverState>;
  lastUpdated: string;
}

// ── SignalR inbound message shapes ───────────────────────
export interface PositionUpdateMessage {
  updateType: 'position';
  driverNumber: number;
  position: number;
  timestamp: string;
}

export interface TimingUpdateMessage {
  updateType: 'timing';
  driverNumber: number;
  lastLapTime: string | null;
  gapToLeader: string | null;
  interval: string | null;
  currentLap: number;
  timestamp: string;
}

export interface PitUpdateMessage {
  updateType: 'pit';
  driverNumber: number;
  inPit: boolean;
  pitStopCount: number;
  newCompound: string | null;
  timestamp: string;
}

export type DriverUpdateMessage =
  | PositionUpdateMessage
  | TimingUpdateMessage
  | PitUpdateMessage;

export interface CarDataMessage {
  driverNumber: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  drsOpen: boolean;
  timestamp: string;
}

export interface SessionStatusMessage {
  status: string;
  totalLaps: number;
  timestamp: string;
}

export interface SafetyCarMessage {
  status: string;
  timestamp: string;
}

// ── Historical types ──────────────────────────────────────
export interface F1Session {
  sessionKey: number;
  sessionName: string;
  sessionType: string;
  dateStart: string;
  circuitShortName: string;
  countryName: string;
  year: number;
  meetingKey: number;
  meetingName: string;
}

export interface DriverClassification {
  position: number;
  driverNumber: number;
  abbreviation: string;
  teamColour: string;
  totalLaps: number;
  bestLapTime: string | null;
  bestLapSeconds: number | null;
}

// ── App state ─────────────────────────────────────────────
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface AppState {
  raceState: RaceState | null;
  connectionStatus: ConnectionStatus;
  selectedDriverNumber: number | null;
  lastUpdateTime: number | null; // Date.now()
}
