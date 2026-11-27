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
  testTabAlert: () => void;
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
  sessionId?: string;
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
  const sessionId = options?.sessionId?.trim() || "";
  const [muted, setMuted] = useState(false);
  const [alertState, setAlertState] = useState<AlertRuntimeState>({
    activeAlert: null,
    audioAlertCount: 0,
    vibrateAlertCount: 0,
    visualAlertCount: 0,
    lastAlertSeq: 0,
  });

  const enabledRef = useRef(enabled);
  const sessionIdRef = useRef(sessionId);
  const mutedRef = useRef(false);
  const seenAlertSeqRef = useRef(0);
  const prevClearedSeqRef = useRef<number | null>(null);
  const highWaterAlertSeqRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

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

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const unacked =
      alertState.activeAlert && !alertState.activeAlert.acknowledgedBy;
    document.title = unacked
      ? `(1) Next · ExamQ`
      : "ExamQ · Bathroom Queue";
    const nav = navigator as unknown as {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unacked) {
      void nav.setAppBadge?.(1).catch(() => {});
    } else {
      void nav.clearAppBadge?.().catch(() => {});
    }
  }, [alertState.activeAlert]);

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
          if (
            prev.activeAlert &&
            snapshot.lastNextAlert &&
            prev.activeAlert.seq === snapshot.lastNextAlert.seq &&
            snapshot.lastNextAlert.acknowledgedBy !==
              prev.activeAlert.acknowledgedBy
          ) {
            return {
              ...prev,
              activeAlert: snapshot.lastNextAlert,
            };
          }
          return prev;
        });
        return;
      }

      if (evaluation.type === "trigger") {
        const isMuted = mutedRef.current;

        if (!isMuted) {
          if (
            typeof document !== "undefined" &&
            document.visibilityState === "hidden" &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            "serviceWorker" in navigator
          ) {
            const activeSessionId = sessionIdRef.current;
            const tag = activeSessionId
              ? `examq-next-${activeSessionId}-${evaluation.alert.sex}-${evaluation.alert.seq}`
              : `examq-next-${evaluation.alert.sex}-${evaluation.alert.seq}`;
            const targetUrl = activeSessionId
              ? `/s/${encodeURIComponent(activeSessionId)}`
              : "/";

            void navigator.serviceWorker.ready
              .then((reg) =>
                reg.showNotification("ExamQ · Queue updated", {
                  body: "Open ExamQ to check the current queue.",
                  icon: "/icons/icon-192.png",
                  badge: "/icons/icon-192.png",
                  tag,
                  silent: true,
                  data: { url: targetUrl },
                }),
              )
              .catch(() => {});
          }
        }

        const isStillNext =
          snapshot.nextBySex[evaluation.alert.sex] === evaluation.alert.entryId;

        setAlertState((prev) => ({
          activeAlert: isStillNext ? evaluation.alert : null,
          audioAlertCount: prev.audioAlertCount,
          vibrateAlertCount: prev.vibrateAlertCount,
          visualAlertCount: prev.visualAlertCount + evaluation.triggerCount,
          lastAlertSeq: evaluation.alert.seq,
        }));
      }
    },
    [],
  );

  const toggleMute = useCallback(() => {
    ensureAudioContext();
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
  }, [ensureAudioContext]);

  const testTabAlert = useCallback(() => {
    playChime();
  }, [playChime]);

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
    testTabAlert,
    dismissAlert,
    handleSnapshot,
  };
}
