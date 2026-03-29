import { useReducer, useCallback } from 'react';
import type {
  AppState,
  RaceState,
  DriverUpdateMessage,
  CarDataMessage,
  SessionStatusMessage,
  SafetyCarMessage,
  ConnectionStatus,
} from '../types';

// ── Actions ───────────────────────────────────────────────
type Action =
  | { type: 'FULL_STATE'; payload: RaceState }
  | { type: 'DRIVER_UPDATE'; payload: DriverUpdateMessage }
  | { type: 'CAR_DATA'; payload: CarDataMessage }
  | { type: 'SESSION_STATUS'; payload: SessionStatusMessage }
  | { type: 'SAFETY_CAR'; payload: SafetyCarMessage }
  | { type: 'CONNECTION_STATUS'; payload: ConnectionStatus }
  | { type: 'SELECT_DRIVER'; payload: number | null };

// ── Initial state ─────────────────────────────────────────
const initial: AppState = {
  raceState: null,
  connectionStatus: 'connecting',
  selectedDriverNumber: null,
  lastUpdateTime: null,
};

// ── Reducer ───────────────────────────────────────────────
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'FULL_STATE':
      return { ...state, raceState: action.payload, lastUpdateTime: Date.now() };

    case 'DRIVER_UPDATE': {
      if (!state.raceState) return state;
      const msg = action.payload;
      const key = String(msg.driverNumber);
      const existing = state.raceState.drivers[key];
      if (!existing) return state;

      let updated = { ...existing };
      if (msg.updateType === 'position') {
        updated.position = msg.position;
      } else if (msg.updateType === 'timing') {
        updated.lastLapTime = msg.lastLapTime;
        updated.gapToLeader = msg.gapToLeader;
        updated.interval = msg.interval;
        updated.currentLap = msg.currentLap;
      } else if (msg.updateType === 'pit') {
        updated.inPit = msg.inPit;
        updated.pitStopCount = msg.pitStopCount;
        if (msg.newCompound) updated.tyreCompound = msg.newCompound;
      }

      return {
        ...state,
        lastUpdateTime: Date.now(),
        raceState: {
          ...state.raceState,
          drivers: { ...state.raceState.drivers, [key]: updated },
        },
      };
    }

    case 'CAR_DATA': {
      if (!state.raceState) return state;
      const { driverNumber, speed, throttle, brake, gear, drsOpen } = action.payload;
      const key = String(driverNumber);
      const existing = state.raceState.drivers[key];
      if (!existing) return state;
      return {
        ...state,
        lastUpdateTime: Date.now(),
        raceState: {
          ...state.raceState,
          drivers: {
            ...state.raceState.drivers,
            [key]: { ...existing, speed, throttle, brake, gear, drsOpen },
          },
        },
      };
    }

    case 'SESSION_STATUS': {
      if (!state.raceState) return state;
      return {
        ...state,
        lastUpdateTime: Date.now(),
        raceState: {
          ...state.raceState,
          status: action.payload.status as RaceState['status'],
          totalLaps: action.payload.totalLaps,
        },
      };
    }

    case 'SAFETY_CAR': {
      if (!state.raceState) return state;
      return {
        ...state,
        lastUpdateTime: Date.now(),
        raceState: { ...state.raceState, safetyCarStatus: action.payload.status },
      };
    }

    case 'CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };

    // Toggle selection — clicking the already-selected driver closes the panel
    case 'SELECT_DRIVER':
      return {
        ...state,
        selectedDriverNumber:
          state.selectedDriverNumber === action.payload ? null : action.payload,
      };

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────
export function useRaceStore() {
  const [state, dispatch] = useReducer(reducer, initial);

  const setFullState = useCallback(
    (p: RaceState) => dispatch({ type: 'FULL_STATE', payload: p }),
    [],
  );
  const applyDriverUpdate = useCallback(
    (p: DriverUpdateMessage) => dispatch({ type: 'DRIVER_UPDATE', payload: p }),
    [],
  );
  const applyCarData = useCallback(
    (p: CarDataMessage) => dispatch({ type: 'CAR_DATA', payload: p }),
    [],
  );
  const applySessionStatus = useCallback(
    (p: SessionStatusMessage) => dispatch({ type: 'SESSION_STATUS', payload: p }),
    [],
  );
  const applySafetyCar = useCallback(
    (p: SafetyCarMessage) => dispatch({ type: 'SAFETY_CAR', payload: p }),
    [],
  );
  const setConnectionStatus = useCallback(
    (p: ConnectionStatus) => dispatch({ type: 'CONNECTION_STATUS', payload: p }),
    [],
  );
  const selectDriver = useCallback(
    (n: number | null) => dispatch({ type: 'SELECT_DRIVER', payload: n }),
    [],
  );

  return {
    state,
    setFullState,
    applyDriverUpdate,
    applyCarData,
    applySessionStatus,
    applySafetyCar,
    setConnectionStatus,
    selectDriver,
  };
}
