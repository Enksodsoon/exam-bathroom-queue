"use client";

import { isValidExamBlockMinutes } from "@/lib/domain/window";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "@/lib/domain/types";
import {
  ApiClientError,
  getSession,
  type GetSessionResponse,
  type RequestAuth,
} from "./api";

const VISIBLE_POLL_MS = 1200;
const HIDDEN_POLL_MS = 5000;
const MAX_BACKOFF_MS = 10_000;
const STALE_THRESHOLD_MS = 10_000;

interface SyncState {
  snapshot: SessionSnapshot | null;
  notFound: boolean;
  syncError: string | null;
  lastSyncedAtMs: number | null;
  lastLocalSuccessMs: number | null;
}

export interface UseSessionSyncOptions {
  enabled?: boolean;
  initialNotFound?: boolean;
  auth?: RequestAuth;
  onSnapshot?: (snapshot: SessionSnapshot, meta: { isInitial: boolean }) => void;
}

export interface UseSessionSyncResult {
  snapshot: SessionSnapshot | null;
  isLoading: boolean;
  notFound: boolean;
  syncError: string | null;
  syncStale: boolean;
  lastSyncedAtMs: number | null;
  lastSyncedAgeSeconds: number | null;
  applyMutationSnapshot: (nextSnapshot: SessionSnapshot) => void;
  refreshNow: () => void;
}

export type UnchangedPollResponse = Extract<
  GetSessionResponse,
  { unchanged: true }
>;

const VALID_WINDOW_STATUSES = new Set([
  "UNCONFIGURED",
  "BEFORE_START",
  "FIRST_30_MIN",
  "ALLOWED",
  "LAST_20_MIN",
  "AFTER_END",
]);

const VALID_ENTRY_STATUSES = new Set([
  "queued",
  "in_bathroom",
  "returned",
  "removed",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidBroadcastSnapshot(
  incoming: unknown,
): incoming is SessionSnapshot {
  if (!isPlainObject(incoming)) {
    return false;
  }

  if (
    typeof incoming.id !== "string" ||
    incoming.id.length === 0 ||
    typeof incoming.createdAt !== "number" ||
    !Number.isFinite(incoming.createdAt) ||
    typeof incoming.version !== "number" ||
    !Number.isInteger(incoming.version) ||
    incoming.version < 1 ||
    typeof incoming.clearedSeq !== "number" ||
    !Number.isInteger(incoming.clearedSeq) ||
    incoming.clearedSeq < 0 ||
    typeof incoming.serverNowMs !== "number" ||
    !Number.isFinite(incoming.serverNowMs) ||
    typeof incoming.effectiveNowMs !== "number" ||
    !Number.isFinite(incoming.effectiveNowMs) ||
    typeof incoming.windowStatus !== "string" ||
    !VALID_WINDOW_STATUSES.has(incoming.windowStatus) ||
    !Array.isArray(incoming.entries) ||
    !Array.isArray(incoming.staff) ||
    !isPlainObject(incoming.nextBySex)
  ) {
    return false;
  }

  if (
    (incoming.nextBySex.M !== null && typeof incoming.nextBySex.M !== "string") ||
    (incoming.nextBySex.F !== null && typeof incoming.nextBySex.F !== "string")
  ) {
    return false;
  }

  if (incoming.examConfig !== null) {
    if (
      !isPlainObject(incoming.examConfig) ||
      typeof incoming.examConfig.startTimeMs !== "number" ||
      !Number.isFinite(incoming.examConfig.startTimeMs) ||
      typeof incoming.examConfig.durationMinutes !== "number" ||
      !Number.isFinite(incoming.examConfig.durationMinutes) ||
      incoming.examConfig.durationMinutes < 1 ||
      (incoming.examConfig.firstBlockMinutes !== undefined &&
        !isValidExamBlockMinutes(incoming.examConfig.firstBlockMinutes)) ||
      (incoming.examConfig.lastBlockMinutes !== undefined &&
        !isValidExamBlockMinutes(incoming.examConfig.lastBlockMinutes))
    ) {
      return false;
    }
    if (
      incoming.examConfig.clockOffsetMs !== undefined &&
      (typeof incoming.examConfig.clockOffsetMs !== "number" ||
        !Number.isFinite(incoming.examConfig.clockOffsetMs))
    ) {
      return false;
    }
  }

  for (const entry of incoming.entries) {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      (entry.sex !== "M" && entry.sex !== "F") ||
      typeof entry.studentNumber !== "string" ||
      typeof entry.status !== "string" ||
      !VALID_ENTRY_STATUSES.has(entry.status) ||
      typeof entry.submittedBy !== "string" ||
      typeof entry.createdAt !== "number" ||
      !Number.isFinite(entry.createdAt) ||
      (entry.enteredAt !== null &&
        (typeof entry.enteredAt !== "number" ||
          !Number.isFinite(entry.enteredAt))) ||
      (entry.returnedAt !== null &&
        (typeof entry.returnedAt !== "number" ||
          !Number.isFinite(entry.returnedAt))) ||
      typeof entry.override !== "boolean"
    ) {
      return false;
    }
  }

  for (const member of incoming.staff) {
    if (
      !isPlainObject(member) ||
      typeof member.id !== "string" ||
      member.id.length === 0 ||
      typeof member.label !== "string" ||
      typeof member.joinedAt !== "number" ||
      !Number.isFinite(member.joinedAt) ||
      typeof member.lastSeenAt !== "number" ||
      !Number.isFinite(member.lastSeenAt)
    ) {
      return false;
    }
  }

  if (incoming.lastNextAlert !== null) {
    if (
      !isPlainObject(incoming.lastNextAlert) ||
      typeof incoming.lastNextAlert.seq !== "number" ||
      !Number.isInteger(incoming.lastNextAlert.seq) ||
      incoming.lastNextAlert.seq < 1 ||
      (incoming.lastNextAlert.sex !== "M" &&
        incoming.lastNextAlert.sex !== "F") ||
      typeof incoming.lastNextAlert.entryId !== "string" ||
      typeof incoming.lastNextAlert.studentNumber !== "string" ||
      typeof incoming.lastNextAlert.triggeredAt !== "number" ||
      !Number.isFinite(incoming.lastNextAlert.triggeredAt)
    ) {
      return false;
    }
  }

  return true;
}

export function isSnapshotNewer(
  candidate: SessionSnapshot,
  current: SessionSnapshot | null,
): boolean {
  if (!current) {
    return true;
  }
  if (candidate.clearedSeq > current.clearedSeq) {
    return true;
  }
  if (candidate.clearedSeq < current.clearedSeq) {
    return false;
  }
  return candidate.version > current.version;
}

export function mergeUnchangedPollState(
  current: SessionSnapshot | null,
  pollRes: UnchangedPollResponse,
): SessionSnapshot | null {
  if (!current || pollRes.version !== current.version) {
    return null;
  }
  return {
    ...current,
    serverNowMs: pollRes.serverNowMs,
    effectiveNowMs: pollRes.effectiveNowMs,
    windowStatus: pollRes.windowStatus,
  };
}

export function useSessionSync(
  sessionId: string,
  options?: UseSessionSyncOptions,
): UseSessionSyncResult {
  const enabled = options?.enabled ?? true;
  const initialNotFound = options?.initialNotFound ?? false;
  const controllerKey = options?.auth?.controllerKey ?? null;
  const staffToken = options?.auth?.staffToken ?? null;
  const shouldSync = enabled && !initialNotFound;

  const [state, setState] = useState<SyncState>({
    snapshot: null,
    notFound: initialNotFound,
    syncError: null,
    lastSyncedAtMs: null,
    lastLocalSuccessMs: null,
  });
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  const currentSnapshotRef = useRef<SessionSnapshot | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pollTriggerRef = useRef<(() => void) | null>(null);
  const onSnapshotRef = useRef(options?.onSnapshot);

  useEffect(() => {
    onSnapshotRef.current = options?.onSnapshot;
  }, [options?.onSnapshot]);

  useEffect(() => {
    if (!shouldSync) {
      return;
    }
    const id = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 2000);
    return () => window.clearInterval(id);
  }, [shouldSync]);

  const commitSnapshot = useCallback(
    (
      nextSnapshot: SessionSnapshot,
      source: "poll" | "mutation" | "broadcast",
    ) => {
      const current = currentSnapshotRef.current;
      if (!isSnapshotNewer(nextSnapshot, current)) {
        return;
      }

      const isInitial = current === null;
      currentSnapshotRef.current = nextSnapshot;

      setState({
        snapshot: nextSnapshot,
        notFound: false,
        syncError: null,
        lastSyncedAtMs: nextSnapshot.serverNowMs,
        lastLocalSuccessMs: Date.now(),
      });

      onSnapshotRef.current?.(nextSnapshot, { isInitial });

      if (source !== "broadcast" && channelRef.current) {
        try {
          channelRef.current.postMessage({
            type: "SNAPSHOT",
            snapshot: nextSnapshot,
          });
        } catch {
          // Ignore BroadcastChannel serialization/closed errors
        }
      }
    },
    [],
  );

  const applyMutationSnapshot = useCallback(
    (nextSnapshot: SessionSnapshot) => {
      commitSnapshot(nextSnapshot, "mutation");
    },
    [commitSnapshot],
  );

  useEffect(() => {
    currentSnapshotRef.current = null;
    if (!shouldSync) {
      return;
    }

    let cancelled = false;
    let stopped = false;
    let timerId: number | null = null;
    let activeController: AbortController | null = null;
    let inFlight = false;
    let pendingPoll = false;
    let consecutiveErrors = 0;

    const channelName = `examq_session_${sessionId}`;
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(channelName);
        channelRef.current = channel;
        channel.onmessage = (event: MessageEvent) => {
          const data = event.data as unknown;
          if (
            isPlainObject(data) &&
            data.type === "SNAPSHOT" &&
            isValidBroadcastSnapshot(data.snapshot) &&
            data.snapshot.id === sessionId
          ) {
            commitSnapshot(data.snapshot, "broadcast");
          }
        };
      } catch {
        channel = null;
        channelRef.current = null;
      }
    }

    const scheduleNext = () => {
      if (cancelled || stopped) {
        return;
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      const baseInterval =
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
          ? HIDDEN_POLL_MS
          : VISIBLE_POLL_MS;
      const interval =
        consecutiveErrors > 0
          ? Math.min(
              MAX_BACKOFF_MS,
              Math.round(baseInterval * Math.pow(1.5, consecutiveErrors)) +
                Math.floor(Math.random() * 400),
            )
          : baseInterval;
      timerId = window.setTimeout(() => {
        void runPoll();
      }, interval);
    };

    const runPoll = async (forceFull = false) => {
      if (cancelled || stopped || inFlight) {
        return;
      }

      inFlight = true;
      pendingPoll = false;
      let retryForceFull = false;
      const controller = new AbortController();
      activeController = controller;

      try {
        const current = currentSnapshotRef.current;
        const sinceVersion =
          !forceFull && current !== null ? current.version : undefined;

        const res = await getSession(sessionId, sinceVersion, controller.signal, {
          controllerKey,
          staffToken,
        });
        if (cancelled) {
          return;
        }
        consecutiveErrors = 0;

        if (!res.unchanged) {
          commitSnapshot(res.snapshot, "poll");
        } else {
          const latestCurrent = currentSnapshotRef.current;
          if (latestCurrent && res.version > latestCurrent.version) {
            retryForceFull = true;
          } else {
            const updated = mergeUnchangedPollState(latestCurrent, res);
            if (updated) {
              currentSnapshotRef.current = updated;
              setState((prev) => ({
                ...prev,
                snapshot: updated,
                notFound: false,
                syncError: null,
                lastSyncedAtMs: res.serverNowMs,
                lastLocalSuccessMs: Date.now(),
              }));
            }
          }
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (err instanceof ApiClientError && err.status === 404) {
          stopped = true;
          if (timerId !== null) {
            window.clearTimeout(timerId);
            timerId = null;
          }
          currentSnapshotRef.current = null;
          setState({
            snapshot: null,
            notFound: true,
            syncError: err.message,
            lastSyncedAtMs: null,
            lastLocalSuccessMs: null,
          });
          return;
        }
        consecutiveErrors += 1;
        const message =
          err instanceof Error ? err.message : "Failed to sync session";
        setState((prev) => ({
          ...prev,
          syncError: message,
        }));
      } finally {
        inFlight = false;
        if (activeController === controller) {
          activeController = null;
        }
        if (!cancelled && !stopped) {
          if (retryForceFull || pendingPoll) {
            pendingPoll = false;
            void runPoll(retryForceFull);
          } else {
            scheduleNext();
          }
        }
      }
    };

    pollTriggerRef.current = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      if (inFlight) {
        pendingPoll = true;
        return;
      }
      void runPoll(false);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        pollTriggerRef.current?.();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void runPoll();

    return () => {
      cancelled = true;
      pollTriggerRef.current = null;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      if (activeController) {
        activeController.abort();
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (channel) {
        channel.close();
      }
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
    };
  }, [sessionId, commitSnapshot, shouldSync, controllerKey, staffToken]);

  const refreshNow = useCallback(() => {
    pollTriggerRef.current?.();
  }, []);

  const effectiveNotFound = initialNotFound || state.notFound;
  const isLoading =
    shouldSync &&
    state.snapshot === null &&
    !effectiveNotFound &&
    state.syncError === null;

  const lastSyncedAgeSeconds =
    shouldSync && state.lastLocalSuccessMs !== null
      ? Math.max(0, Math.floor((nowTickMs - state.lastLocalSuccessMs) / 1000))
      : null;

  const syncStale =
    shouldSync &&
    (state.syncError !== null ||
      (state.lastLocalSuccessMs !== null &&
        nowTickMs - state.lastLocalSuccessMs > STALE_THRESHOLD_MS));

  return {
    snapshot: shouldSync ? state.snapshot : null,
    isLoading,
    notFound: effectiveNotFound,
    syncError: shouldSync ? state.syncError : null,
    syncStale,
    lastSyncedAtMs: shouldSync ? state.lastSyncedAtMs : null,
    lastSyncedAgeSeconds,
    applyMutationSnapshot,
    refreshNow,
  };
}
