import { useEffect, useRef } from 'react';
import type { ReplayState } from '../utils/replayUtils';

const CHANNEL = 'f1-replay-sync';

/** Broadcasts replay state at ~30Hz so popup windows can follow along */
export function useReplaySender(rs: ReplayState, sessionKey: number | undefined) {
  const rsRef = useRef(rs);
  useEffect(() => { rsRef.current = rs; }, [rs]);

  useEffect(() => {
    if (!sessionKey) return;
    const ch = new BroadcastChannel(CHANNEL);
    const id = setInterval(() => {
      ch.postMessage({
        type: 'sync',
        sessionKey,
        currentTime: rsRef.current.currentTime,
        playing: rsRef.current.playing,
        speed: rsRef.current.speed,
      });
    }, 33); // ~30 Hz
    return () => { clearInterval(id); ch.close(); };
  }, [sessionKey]);
}

/** Receives replay sync messages and applies them to the engine actions */
export function useReplayReceiver(
  sessionKey: number | undefined,
  actions: { scrub: (t: number) => void; setSpeed: (s: number) => void },
) {
  useEffect(() => {
    if (!sessionKey) return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d.type !== 'sync' || d.sessionKey !== sessionKey) return;
      actions.setSpeed(d.speed);
      actions.scrub(d.currentTime);
    };
    return () => ch.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
}
