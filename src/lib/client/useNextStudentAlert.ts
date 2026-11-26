"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertInfo, SessionSnapshot } from "@/lib/domain/types";

export interface ExamqAlertStats {
  audioAlertCount: number;
  vibrateAlertCount: number;
  visualAlertCount: number;
  lastAlertSeq: number;
  muted: boolean;
}

declare global {
  interface Window {
    __examqAlertStats?: ExamqAlertStats;
  }
}

export interface UseNextStudentAlertResult {
  activeAlert: AlertInfo | null;
  muted: boolean;
  audioAlertCount: number;
  vibrateAlertCount: number;
  visualAlertCount: number;
  lastAlertSeq: number;
  toggleMute: () => void;
  dismissAlert: () => void;
  handleSnapshot: (snapshot: SessionSnapshot, meta: { isInitial: boolean }) => void;
}

interface AlertRuntimeState {
  activeAlert: AlertInfo | null;
  audioAlertCount: number;
  vibrateAlertCount: number;
  visualAlertCount: number;
  lastAlertSeq: number;
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export interface UseNextStudentAlertOptions {
  enabled?: boolean;
}

export interface AlertTrackerState {
  seenAlertSeq: number;
  prevClearedSeq: number | null;
  highWaterAlertSeq?: number;
}

export type AlertEvaluationAction =
  | {
      type: "reset";
      nextTracker: AlertTrackerState;
      lastAlertSeq: number;
    }
  | {
      type: "trigger";
      nextTracker: AlertTrackerState;
      alert: AlertInfo;
      triggerCount: number;
    }
  | {
      type: "noop";
      nextTracker: AlertTrackerState;
    };

export function evaluateAlertSnapshot(
  tracker: AlertTrackerState,
  snapshot: SessionSnapshot,
  meta: { isInitial: boolean; enabled: boolean },
): AlertEvaluationAction {
  const latestAlert = snapshot.lastNextAlert;
  const latestSeq = latestAlert?.seq ?? 0;
  const prevHighWater = tracker.highWaterAlertSeq ?? 0;

  if (meta.isInitial || !meta.enabled) {
    return {
      type: "reset",
      nextTracker: {
        seenAlertSeq: latestSeq,
        prevClearedSeq: snapshot.clearedSeq,
        highWaterAlertSeq: Math.max(prevHighWater, latestSeq),
      },
      lastAlertSeq: latestSeq,
    };
  }

  const didClear =
    tracker.prevClearedSeq !== null &&
    snapshot.clearedSeq > tracker.prevClearedSeq;

  if (didClear && !latestAlert) {
    return {
      type: "reset",
      nextTracker: {
        seenAlertSeq: 0,
        prevClearedSeq: snapshot.clearedSeq,
        highWaterAlertSeq: Math.max(prevHighWater, tracker.seenAlertSeq),
      },
      lastAlertSeq: 0,
    };
  }

  if (latestAlert && latestAlert.seq > tracker.seenAlertSeq) {
    const hasUnknownPostClearBaseline =
      prevHighWater === 0 &&
      tracker.seenAlertSeq === 0 &&
      (tracker.prevClearedSeq ?? 0) > 0;
    const baselineSeq = Math.max(tracker.seenAlertSeq, prevHighWater);
    const triggerCount = hasUnknownPostClearBaseline
      ? 1
      : Math.max(1, latestAlert.seq - baselineSeq);
    return {
      type: "trigger",
      nextTracker: {
        seenAlertSeq: latestAlert.seq,
        prevClearedSeq: snapshot.clearedSeq,
        highWaterAlertSeq: Math.max(baselineSeq, latestAlert.seq),
      },
      alert: latestAlert,
      triggerCount,
    };
  }

  if (didClear) {
    return {
      type: "reset",
      nextTracker: {
        seenAlertSeq: tracker.seenAlertSeq,
        prevClearedSeq: snapshot.clearedSeq,
        highWaterAlertSeq: Math.max(
          prevHighWater,
          tracker.seenAlertSeq,
          latestSeq,
        ),
      },
      lastAlertSeq: latestSeq,
    };
  }

  return {
    type: "noop",
    nextTracker: {
      seenAlertSeq: tracker.seenAlertSeq,
      prevClearedSeq: snapshot.clearedSeq,
      highWaterAlertSeq: Math.max(prevHighWater, tracker.seenAlertSeq),
    },
  };
}

export function useNextStudentAlert(
  options?: UseNextStudentAlertOptions,
): UseNextStudentAlertResult {
  const enabled = options?.enabled ?? true;
  const [muted, setMuted] = useState(false);
  const [alertState, setAlertState] = useState<AlertRuntimeState>({
    activeAlert: null,
    audioAlertCount: 0,
    vibrateAlertCount: 0,
    visualAlertCount: 0,
    lastAlertSeq: 0,
  });

  const enabledRef = useRef(enabled);
  const mutedRef = useRef(false);
  const seenAlertSeqRef = useRef(0);
  const prevClearedSeqRef = useRef<number | null>(null);
  const highWaterAlertSeqRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    const Ctor = getAudioContextConstructor();
    if (!Ctor) {
      return null;
    }
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new Ctor();
      }
      if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume().catch(() => {});
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const unlock = () => {
      ensureAudioContext();
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, [ensureAudioContext]);

  const playChime = useCallback(
    (delaySeconds = 0): boolean => {
      try {
        const ctx = ensureAudioContext();
        if (!ctx) {
          return false;
        }
        const safeDelay =
          typeof delaySeconds === "number" &&
          Number.isFinite(delaySeconds) &&
          delaySeconds > 0
            ? delaySeconds
            : 0;
        const startAt = ctx.currentTime + safeDelay;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.36);
        gain.connect(ctx.destination);

        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(880, startAt);
        osc1.frequency.setValueAtTime(1174.66, startAt + 0.14);
        osc1.connect(gain);
        osc1.start(startAt);
        osc1.stop(startAt + 0.37);
        return true;
      } catch {
        return false;
      }
    },
    [ensureAudioContext],
  );

  const triggerVibrate = useCallback((): boolean => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.vibrate !== "function"
    ) {
      return false;
    }
    try {
      return navigator.vibrate([200, 100, 200]) !== false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.__examqAlertStats = {
      audioAlertCount: alertState.audioAlertCount,
      vibrateAlertCount: alertState.vibrateAlertCount,
      visualAlertCount: alertState.visualAlertCount,
      lastAlertSeq: alertState.lastAlertSeq,
      muted,
    };
  }, [
    alertState.audioAlertCount,
    alertState.vibrateAlertCount,
    alertState.visualAlertCount,
    alertState.lastAlertSeq,
    muted,
  ]);

  const handleSnapshot = useCallback(
    (snapshot: SessionSnapshot, meta: { isInitial: boolean }) => {
      const evaluation = evaluateAlertSnapshot(
        {
          seenAlertSeq: seenAlertSeqRef.current,
          prevClearedSeq: prevClearedSeqRef.current,
          highWaterAlertSeq: highWaterAlertSeqRef.current,
        },
        snapshot,
        { isInitial: meta.isInitial, enabled: enabledRef.current },
      );

      seenAlertSeqRef.current = evaluation.nextTracker.seenAlertSeq;
      prevClearedSeqRef.current = evaluation.nextTracker.prevClearedSeq;
      highWaterAlertSeqRef.current =
        evaluation.nextTracker.highWaterAlertSeq ?? 0;

      if (evaluation.type === "reset") {
        setAlertState((prev) => ({
          ...prev,
          activeAlert: null,
          lastAlertSeq: evaluation.lastAlertSeq,
        }));
        return;
      }

      if (evaluation.type === "noop") {
        setAlertState((prev) => {
          if (
            prev.activeAlert &&
            snapshot.nextBySex[prev.activeAlert.sex] !== prev.activeAlert.entryId
          ) {
            return {
              ...prev,
              activeAlert: null,
            };
          }
          return prev;
        });
        return;
      }

      if (evaluation.type === "trigger") {
        const isMuted = mutedRef.current;
        let audioDelta = 0;
        let vibrateDelta = 0;

        if (!isMuted) {
          const playbackCount = Math.min(evaluation.triggerCount, 10);
          for (let i = 0; i < playbackCount; i += 1) {
            if (playChime(i * 0.4)) {
              audioDelta += 1;
            }
            if (triggerVibrate()) {
              vibrateDelta += 1;
            }
          }
        }

        const isStillNext =
          snapshot.nextBySex[evaluation.alert.sex] === evaluation.alert.entryId;

        setAlertState((prev) => ({
          activeAlert: isStillNext ? evaluation.alert : null,
          audioAlertCount: prev.audioAlertCount + audioDelta,
          vibrateAlertCount: prev.vibrateAlertCount + vibrateDelta,
          visualAlertCount: prev.visualAlertCount + evaluation.triggerCount,
          lastAlertSeq: evaluation.alert.seq,
        }));
      }
    },
    [playChime, triggerVibrate],
  );

  const toggleMute = useCallback(() => {
    ensureAudioContext();
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
  }, [ensureAudioContext]);

  const dismissAlert = useCallback(() => {
    setAlertState((prev) => ({
      ...prev,
      activeAlert: null,
    }));
  }, []);

  return {
    activeAlert: alertState.activeAlert,
    muted,
    audioAlertCount: alertState.audioAlertCount,
    vibrateAlertCount: alertState.vibrateAlertCount,
    visualAlertCount: alertState.visualAlertCount,
    lastAlertSeq: alertState.lastAlertSeq,
    toggleMute,
    dismissAlert,
    handleSnapshot,
  };
}
