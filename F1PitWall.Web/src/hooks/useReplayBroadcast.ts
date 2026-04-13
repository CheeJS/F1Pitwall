import { useEffect, useRef } from 'react';
import type { ReplayState } from '../utils/replayUtils';

const CHANNEL = 'f1-replay-sync';

interface SyncMessage {
  type: 'sync';
  sessionKey: number;
  currentTime: number;
  playing: boolean;
  speed: number;
  highlightedDriver: number | null;
}

interface CloseMessage {
  type: 'closed';
  sessionKey: number;
}

type ChannelMessage = SyncMessage | CloseMessage;

interface SenderOpts {
  rs: ReplayState;
  sessionKey: number | undefined;
  highlightedDriver?: number | null;
}

/** Broadcasts replay state at ~30Hz so popup windows can follow along.
 *  Also emits a 'closed' message on window unload so popups can detach
 *  cleanly rather than stalling on stale playback state. */
export function useReplaySender({ rs, sessionKey, highlightedDriver }: SenderOpts) {
  const rsRef = useRef(rs);
  const hiRef = useRef<number | null>(highlightedDriver ?? null);
  useEffect(() => { rsRef.current = rs; }, [rs]);
  useEffect(() => { hiRef.current = highlightedDriver ?? null; }, [highlightedDriver]);

  useEffect(() => {
    if (!sessionKey || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);

    const id = setInterval(() => {
      const msg: SyncMessage = {
        type: 'sync',
        sessionKey,
        currentTime: rsRef.current.currentTime,
        playing: rsRef.current.playing,
        speed: rsRef.current.speed,
        highlightedDriver: hiRef.current,
      };
      ch.postMessage(msg);
    }, 33); // ~30 Hz

    const onClose = () => {
      const msg: CloseMessage = { type: 'closed', sessionKey };
      try { ch.postMessage(msg); } catch { /* closing already */ }
    };
    window.addEventListener('beforeunload', onClose);

    return () => {
      clearInterval(id);
      onClose();
      window.removeEventListener('beforeunload', onClose);
      ch.close();
    };
  }, [sessionKey]);
}

interface ReceiverActions {
  scrub: (t: number) => void;
  setSpeed: (s: number) => void;
  /** Optional — popup may want to mirror the main window's highlighted driver */
  setHighlightedDriver?: (n: number | null) => void;
  /** Optional — popup wants to know when the main window has closed */
  onMainClosed?: () => void;
}

/** Receives replay sync messages and applies them to the engine actions.
 *  Actions are stored in a ref so the subscription never goes stale without
 *  re-subscribing the channel on every parent render. */
export function useReplayReceiver(sessionKey: number | undefined, actions: ReceiverActions) {
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);

  useEffect(() => {
    if (!sessionKey || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent<ChannelMessage>) => {
      const d = e.data;
      if (!d || d.sessionKey !== sessionKey) return;
      if (d.type === 'closed') {
        actionsRef.current.onMainClosed?.();
        return;
      }
      // 'sync' — scrub first, then speed, so the playhead lands before rate changes
      actionsRef.current.scrub(d.currentTime);
      actionsRef.current.setSpeed(d.speed);
      if (d.highlightedDriver !== undefined) {
        actionsRef.current.setHighlightedDriver?.(d.highlightedDriver);
      }
    };
    return () => ch.close();
  }, [sessionKey]);
}
