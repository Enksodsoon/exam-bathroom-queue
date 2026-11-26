"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EntryAction, SessionSnapshot, Sex } from "@/lib/domain/types";
import {
  ApiClientError,
  applyEntryAction,
  clearSession,
  reorderEntry,
  submitEntry,
  updateConfig,
} from "@/lib/client/api";
import {
  createSerialMutationQueue,
  type EnqueueMutation,
} from "@/lib/client/mutationQueue";
import {
  describeWindowStatus,
  formatTimeOnly,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  windowBadgeClasses,
} from "@/lib/client/format";
import type { UseNextStudentAlertResult } from "@/lib/client/useNextStudentAlert";
import { AlertBanner } from "./AlertBanner";
import { ExamTimelineBar } from "./ExamTimelineBar";
import {
  BellIcon,
  BellOffIcon,
  ClockIcon,
  CloseIcon,
  FemaleIcon,
  MaleIcon,
  PlusIcon,
  QrIcon,
  ResetIcon,
  ShieldIcon,
  UsersIcon,
} from "./Icons";
import { QrShareCard } from "./QrShareCard";
import { QueueColumn } from "./QueueColumn";

interface ControllerDashboardProps {
  sessionId: string;
  controllerKey: string;
  snapshot: SessionSnapshot | null;
  syncError: string | null;
  lastSyncedAtMs: number | null;
  alert: UseNextStudentAlertResult;
  onMutationSnapshot: (snapshot: SessionSnapshot) => void;
}

interface ConfigDraft {
  startLocal: string;
  exactStartMs: number | null;
  durationMinutes: string;
  offsetMinutes: string;
}

type ActiveDrawer = "timer" | "qr" | "staff" | null;

export function ControllerDashboard({
  sessionId,
  controllerKey,
  snapshot,
  syncError,
  lastSyncedAtMs,
  alert,
  onMutationSnapshot,
}: ControllerDashboardProps) {
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const savingConfigRef = useRef(false);
  const [configMessageState, setConfigMessageState] = useState<{
    clearedSeq: number;
    tone: "error" | "success";
    text: string;
  } | null>(null);

  const [addSex, setAddSex] = useState<Sex>("M");
  const [addStudentNumber, setAddStudentNumber] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [submittingStudent, setSubmittingStudent] = useState(false);
  const submittingStudentRef = useRef(false);
  const [studentMessageState, setStudentMessageState] = useState<{
    clearedSeq: number;
    tone: "error" | "success";
    text: string;
  } | null>(null);

  const [busyEntryIds, setBusyEntryIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const busyEntryIdsRef = useRef(new Set<string>());
  const [queueErrorState, setQueueErrorState] = useState<{
    clearedSeq: number;
    text: string;
  } | null>(null);

  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);
  const clearingSessionRef = useRef(false);
  const [clearMessage, setClearMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);

  const mutationQueueRef = useRef<EnqueueMutation | null>(null);
  const latestClearedSeqRef = useRef<number>(snapshot?.clearedSeq ?? 0);

  useEffect(() => {
    if (snapshot) {
      latestClearedSeqRef.current = snapshot.clearedSeq;
    }
  }, [snapshot]);

  const enqueueMutation: EnqueueMutation = (task) => {
    if (!mutationQueueRef.current) {
      mutationQueueRef.current = createSerialMutationQueue();
    }
    return mutationQueueRef.current(task);
  };

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 rounded-3xl border border-slate-200/90 bg-white p-8 text-center text-sm break-words [overflow-wrap:anywhere] text-slate-500 shadow-xs">
        <p className="font-mono text-xs">Loading controller {sessionId}...</p>
        {syncError && (
          <div
            role="alert"
            data-testid="initial-sync-error"
            className="min-w-0 max-w-full rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs break-words [overflow-wrap:anywhere] text-amber-900"
          >
            Sync warning: {syncError} (retrying automatically)
          </div>
        )}
      </div>
    );
  }

  const currentClearedSeq = snapshot.clearedSeq;
  const configMessage =
    configMessageState && configMessageState.clearedSeq === currentClearedSeq
      ? configMessageState
      : null;
  const studentMessage =
    studentMessageState && studentMessageState.clearedSeq === currentClearedSeq
      ? studentMessageState
      : null;
  const queueError =
    queueErrorState && queueErrorState.clearedSeq === currentClearedSeq
      ? queueErrorState.text
      : null;

  const windowMeta = describeWindowStatus(snapshot.windowStatus);

  const baseConfigValues: ConfigDraft = snapshot.examConfig
    ? {
        startLocal: toDateTimeLocalValue(snapshot.examConfig.startTimeMs),
        exactStartMs: snapshot.examConfig.startTimeMs,
        durationMinutes: String(snapshot.examConfig.durationMinutes),
        offsetMinutes: String(
          Math.round((snapshot.examConfig.clockOffsetMs ?? 0) / 60_000),
        ),
      }
    : {
        startLocal: toDateTimeLocalValue(snapshot.serverNowMs),
        exactStartMs: null,
        durationMinutes: "120",
        offsetMinutes: "0",
      };

  const activeConfig = configDraft ?? baseConfigValues;
  const parsedDurationNum = Number(activeConfig.durationMinutes);
  const showShortDurationWarning =
    Number.isFinite(parsedDurationNum) &&
    parsedDurationNum >= 1 &&
    parsedDurationNum <= 50;

  const updateDraft = (patch: Partial<ConfigDraft>) => {
    setConfigDraft((prev) => ({
      ...(prev ?? baseConfigValues),
      ...patch,
    }));
    if (configMessage) {
      setConfigMessageState(null);
    }
  };

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (savingConfigRef.current) {
      return;
    }

    const startMs =
      activeConfig.exactStartMs ??
      fromDateTimeLocalValue(activeConfig.startLocal);
    if (startMs === null) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Enter a valid start time.",
      });
      return;
    }

    const duration = Number(activeConfig.durationMinutes);
    if (!Number.isFinite(duration) || duration < 1) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Duration must be ≥ 1 min.",
      });
      return;
    }

    const offsetMins = Number(activeConfig.offsetMinutes || "0");
    if (!Number.isFinite(offsetMins)) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Offset must be a number.",
      });
      return;
    }

    savingConfigRef.current = true;
    setSavingConfig(true);
    setConfigMessageState(null);

    try {
      await enqueueMutation(async () => {
        const res = await updateConfig(sessionId, controllerKey, {
          startTimeMs: startMs,
          durationMinutes: duration,
          clockOffsetMs: Math.round(offsetMins * 60_000),
        });
        onMutationSnapshot(res.snapshot);
        setConfigDraft(null);
        setConfigMessageState({
          clearedSeq: res.snapshot.clearedSeq,
          tone: "success",
          text: "Timer saved.",
        });
      });
    } catch (err) {
      setConfigMessageState({
        clearedSeq: latestClearedSeqRef.current,
        tone: "error",
        text:
          err instanceof ApiClientError
            ? err.message
            : "Failed to save timer.",
      });
    } finally {
      savingConfigRef.current = false;
      setSavingConfig(false);
    }
  };

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingStudentRef.current) {
      return;
    }
    const trimmed = addStudentNumber.trim();
    if (!trimmed) {
      setStudentMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Enter a student number.",
      });
      return;
    }

    const sexToSubmit = addSex;
    const useOverride = overrideEnabled;

    submittingStudentRef.current = true;
    setSubmittingStudent(true);
    setStudentMessageState(null);
    setQueueErrorState(null);

    try {
      await enqueueMutation(async () => {
        const res = await submitEntry(
          sessionId,
          {
            sex: sexToSubmit,
            studentNumber: trimmed,
            submittedBy: "Controller",
            ...(useOverride ? { override: true } : {}),
          },
          useOverride ? controllerKey : undefined,
        );
        onMutationSnapshot(res.snapshot);
        setAddStudentNumber("");
        setStudentMessageState({
          clearedSeq: res.snapshot.clearedSeq,
          tone: "success",
          text: `${sexToSubmit === "M" ? "♂" : "♀"} #${res.entry.studentNumber} added${res.entry.override ? " (Override)" : ""}`,
        });
      });
    } catch (err) {
      setStudentMessageState({
        clearedSeq: latestClearedSeqRef.current,
        tone: "error",
        text:
          err instanceof ApiClientError
            ? err.message
            : "Failed to add student.",
      });
    } finally {
      submittingStudentRef.current = false;
      setSubmittingStudent(false);
    }
  };

  const handleEntryAction = async (entryId: string, action: EntryAction) => {
    if (busyEntryIdsRef.current.has(entryId)) {
      return;
    }
    const useOverride = action === "enter" && overrideEnabled;
    busyEntryIdsRef.current.add(entryId);
    setBusyEntryIds(new Set(busyEntryIdsRef.current));
    setQueueErrorState(null);
    try {
      await enqueueMutation(async () => {
        const res = await applyEntryAction(
          sessionId,
          controllerKey,
          entryId,
          action,
          useOverride ? { override: true } : undefined,
        );
        onMutationSnapshot(res.snapshot);
      });
    } catch (err) {
      setQueueErrorState({
        clearedSeq: latestClearedSeqRef.current,
        text:
          err instanceof ApiClientError
            ? err.message
            : `Failed to ${action} entry.`,
      });
    } finally {
      busyEntryIdsRef.current.delete(entryId);
      setBusyEntryIds(new Set(busyEntryIdsRef.current));
    }
  };

  const handleReorder = async (entryId: string, direction: "up" | "down") => {
    if (busyEntryIdsRef.current.has(entryId)) {
      return;
    }
    busyEntryIdsRef.current.add(entryId);
    setBusyEntryIds(new Set(busyEntryIdsRef.current));
    setQueueErrorState(null);
    try {
      await enqueueMutation(async () => {
        const res = await reorderEntry(sessionId, controllerKey, {
          entryId,
          direction,
        });
        onMutationSnapshot(res.snapshot);
      });
    } catch (err) {
      setQueueErrorState({
        clearedSeq: latestClearedSeqRef.current,
        text:
          err instanceof ApiClientError
            ? err.message
            : "Failed to reorder entry.",
      });
    } finally {
      busyEntryIdsRef.current.delete(entryId);
      setBusyEntryIds(new Set(busyEntryIdsRef.current));
    }
  };

  const handleClearSession = async () => {
    if (clearingSessionRef.current) {
      return;
    }
    clearingSessionRef.current = true;
    setClearingSession(true);
    setClearMessage(null);
    setQueueErrorState(null);
    try {
      await enqueueMutation(async () => {
        const res = await clearSession(sessionId, controllerKey);
        onMutationSnapshot(res.snapshot);
        setConfirmingClear(false);
        setClearMessage({
          tone: "success",
          text: "Session cleared.",
        });
      });
    } catch (err) {
      setClearMessage({
        tone: "error",
        text:
          err instanceof ApiClientError
            ? err.message
            : "Failed to clear session.",
      });
    } finally {
      clearingSessionRef.current = false;
      setClearingSession(false);
    }
  };

  const toggleDrawer = (drawer: Exclude<ActiveDrawer, null>) => {
    setActiveDrawer((prev) => (prev === drawer ? null : drawer));
  };

  return (
    <div className="space-y-4">
      {/* Slim Focus-First Top Bar */}
      <header className="rounded-3xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span
              data-testid="window-status-badge"
              data-window-status={snapshot.windowStatus}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${windowBadgeClasses(
                windowMeta.tone,
              )}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  snapshot.windowStatus === "ALLOWED"
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                }`}
              />
              {windowMeta.label}
            </span>

            <ExamTimelineBar
              examConfig={snapshot.examConfig}
              effectiveNowMs={snapshot.effectiveNowMs}
              windowStatus={snapshot.windowStatus}
              compact
            />

            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {formatTimeOnly(snapshot.effectiveNowMs)}
            </span>

            {lastSyncedAtMs !== null && (
              <span
                title="Live Sync"
                className="h-2 w-2 rounded-full bg-emerald-500"
              />
            )}
          </div>

          {/* Single-Tap Icon Triggers */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleDrawer("timer")}
              aria-expanded={activeDrawer === "timer"}
              aria-label="Exam Timer Settings"
              title="Exam Timer Settings"
              className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                activeDrawer === "timer"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <ClockIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Timer</span>
            </button>

            <button
              type="button"
              onClick={() => toggleDrawer("qr")}
              aria-expanded={activeDrawer === "qr"}
              aria-label="Share QR Code"
              title="Share QR Code"
              className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                activeDrawer === "qr"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <QrIcon className="h-4 w-4" />
              <span className="hidden sm:inline">QR</span>
            </button>

            <button
              type="button"
              onClick={() => toggleDrawer("staff")}
              aria-expanded={activeDrawer === "staff"}
              aria-label="Connected Staff"
              title="Connected Staff"
              className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                activeDrawer === "staff"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <UsersIcon className="h-4 w-4" />
              <span className="font-mono tabular-nums">
                {snapshot.staff.length}
              </span>
            </button>

            <button
              type="button"
              onClick={alert.toggleMute}
              aria-pressed={alert.muted}
              aria-label={alert.muted ? "Unmute Alerts" : "Mute Alerts"}
              title={alert.muted ? "Unmute Alerts" : "Mute Alerts"}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition ${
                alert.muted
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {alert.muted ? (
                <BellOffIcon className="h-4 w-4" />
              ) : (
                <BellIcon className="h-4 w-4" />
              )}
            </button>

            {!confirmingClear ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmingClear(true);
                  setClearMessage(null);
                }}
                aria-label="Clear Session"
                title="Clear Session"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600 transition hover:bg-rose-100"
              >
                <ResetIcon className="h-4 w-4" />
              </button>
            ) : (
              <div className="flex items-center gap-1 rounded-full bg-rose-50 p-1">
                <button
                  type="button"
                  disabled={clearingSession}
                  onClick={() => {
                    void handleClearSession();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-rose-600 px-3.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                >
                  {clearingSession ? "..." : "Confirm Clear"}
                </button>
                <button
                  type="button"
                  disabled={clearingSession}
                  onClick={() => setConfirmingClear(false)}
                  aria-label="Cancel"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-600 hover:bg-slate-100"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {syncError && (
          <div
            role="status"
            className="mt-2.5 min-w-0 max-w-full rounded-2xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs break-words [overflow-wrap:anywhere] text-amber-900"
          >
            Sync warning: {syncError} (retrying automatically)
          </div>
        )}

        {clearMessage && (
          <div
            role={clearMessage.tone === "error" ? "alert" : "status"}
            className={`mt-2.5 min-w-0 max-w-full rounded-2xl border px-3 py-1.5 text-xs font-medium break-words [overflow-wrap:anywhere] ${
              clearMessage.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {clearMessage.text}
          </div>
        )}
      </header>

      {/* Top-Bar Drawers (Timer / QR / Staff) */}
      {activeDrawer === "timer" && (
        <section
          aria-label="Exam Time-Window Configuration"
          className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">
                Exam Timer
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveDrawer(null)}
              aria-label="Close Timer"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <ExamTimelineBar
            examConfig={snapshot.examConfig}
            effectiveNowMs={snapshot.effectiveNowMs}
            windowStatus={snapshot.windowStatus}
          />

          <form
            onSubmit={(e) => {
              void handleSaveConfig(e);
            }}
            className="mt-4 space-y-3"
            noValidate
          >
            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Set Start = Now"
                onClick={() =>
                  updateDraft({
                    startLocal: toDateTimeLocalValue(snapshot.serverNowMs),
                    exactStartMs: snapshot.serverNowMs,
                  })
                }
                className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-emerald-500/12 px-3.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20"
              >
                Start Now
              </button>
              {[90, 120, 180].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() =>
                    updateDraft({ durationMinutes: String(mins) })
                  }
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition ${
                    activeConfig.durationMinutes === String(mins)
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {mins}m
                </button>
              ))}
              {[-35, 0, 35, 105].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => updateDraft({ offsetMinutes: String(mins) })}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-mono font-medium text-slate-700 hover:bg-slate-100"
                >
                  {mins > 0 ? `+${mins}m` : `${mins}m`}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="exam-start-time"
                  className="mb-1 block text-[11px] font-medium text-slate-500"
                >
                  Start
                </label>
                <input
                  id="exam-start-time"
                  name="startTime"
                  type="datetime-local"
                  value={activeConfig.startLocal}
                  onChange={(e) =>
                    updateDraft({
                      startLocal: e.target.value,
                      exactStartMs: null,
                    })
                  }
                  className="min-h-[44px] w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="exam-duration-minutes"
                  className="mb-1 block text-[11px] font-medium text-slate-500"
                >
                  Duration (min)
                </label>
                <input
                  id="exam-duration-minutes"
                  name="durationMinutes"
                  type="number"
                  min={1}
                  step={1}
                  value={activeConfig.durationMinutes}
                  onChange={(e) =>
                    updateDraft({ durationMinutes: e.target.value })
                  }
                  className="min-h-[44px] w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="exam-clock-offset"
                  className="mb-1 block text-[11px] font-medium text-slate-500"
                >
                  Offset (min)
                </label>
                <input
                  id="exam-clock-offset"
                  name="clockOffsetMinutes"
                  type="number"
                  step={1}
                  value={activeConfig.offsetMinutes}
                  onChange={(e) =>
                    updateDraft({ offsetMinutes: e.target.value })
                  }
                  className="min-h-[44px] w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {showShortDurationWarning && (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Duration ≤ 50m leaves no open middle window (30m + 20m).
              </p>
            )}

            {configMessage && (
              <div
                role={configMessage.tone === "error" ? "alert" : "status"}
                className={`min-w-0 max-w-full rounded-2xl border px-3 py-2 text-xs font-medium break-words [overflow-wrap:anywhere] ${
                  configMessage.tone === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {configMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={savingConfig}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {savingConfig ? "Saving..." : "Save Exam Config"}
            </button>
          </form>
        </section>
      )}

      {activeDrawer === "qr" && <QrShareCard sessionId={sessionId} />}

      {activeDrawer === "staff" && (
        <section
          aria-label="Connected Staff"
          className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Connected Staff ({snapshot.staff.length})
            </h2>
            <button
              type="button"
              onClick={() => setActiveDrawer(null)}
              aria-label="Close Staff List"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          {snapshot.staff.length === 0 ? (
            <p className="text-xs text-slate-500">
              No roaming staff joined yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {snapshot.staff.map((member) => (
                <span
                  key={member.id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-800"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="max-w-[160px] truncate">{member.label}</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {formatTimeOnly(member.joinedAt)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Alert Telemetry & Floating Spotlight */}
      <AlertBanner
        activeAlert={alert.activeAlert}
        muted={alert.muted}
        audioAlertCount={alert.audioAlertCount}
        vibrateAlertCount={alert.vibrateAlertCount}
        lastAlertSeq={alert.lastAlertSeq}
        onToggleMute={alert.toggleMute}
        onDismiss={alert.dismissAlert}
        hideMuteControl
      />

      {/* Slim Inline Quick-Add Bar */}
      <section
        aria-label="Controller Add Student"
        className="rounded-3xl border border-slate-200/90 bg-white p-3.5 shadow-xs"
      >
        <form
          onSubmit={(e) => {
            void handleAddStudent(e);
          }}
          className="flex flex-wrap items-center gap-2"
          noValidate
        >
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
            <button
              type="button"
              aria-pressed={addSex === "M"}
              aria-label="Male"
              onClick={() => setAddSex("M")}
              className={`inline-flex h-11 items-center gap-1 rounded-full px-3.5 text-xs font-semibold transition ${
                addSex === "M"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MaleIcon className="h-3.5 w-3.5" />
              <span>M</span>
            </button>
            <button
              type="button"
              aria-pressed={addSex === "F"}
              aria-label="Female"
              onClick={() => setAddSex("F")}
              className={`inline-flex h-11 items-center gap-1 rounded-full px-3.5 text-xs font-semibold transition ${
                addSex === "F"
                  ? "bg-rose-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FemaleIcon className="h-3.5 w-3.5" />
              <span>F</span>
            </button>
          </div>

          <label htmlFor="controller-student-number" className="sr-only">
            Student Number
          </label>
          <input
            id="controller-student-number"
            name="controllerStudentNumber"
            type="text"
            maxLength={32}
            value={addStudentNumber}
            onChange={(e) => {
              setAddStudentNumber(e.target.value);
              if (studentMessage) {
                setStudentMessageState(null);
              }
            }}
            placeholder="Student #"
            className="min-h-[44px] min-w-[120px] flex-1 rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2 font-mono text-sm font-semibold text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
          />

          <button
            type="button"
            role="switch"
            aria-checked={overrideEnabled}
            aria-label="Controller Override"
            title="Controller Override (bypass time window)"
            onClick={() => setOverrideEnabled((prev) => !prev)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition ${
              overrideEnabled
                ? "border-purple-300 bg-purple-100 text-purple-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <ShieldIcon className="h-3.5 w-3.5" />
            <span>Override</span>
          </button>

          <button
            type="submit"
            disabled={submittingStudent}
            aria-label="Add Student"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-slate-900 px-5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            <span>{submittingStudent ? "..." : "Add"}</span>
          </button>
        </form>

        {studentMessage && (
          <div
            role={studentMessage.tone === "error" ? "alert" : "status"}
            data-testid="controller-add-message"
            className={`mt-2.5 min-w-0 max-w-full rounded-2xl border px-3.5 py-2 text-xs font-medium break-words [overflow-wrap:anywhere] ${
              studentMessage.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {studentMessage.text}
          </div>
        )}
      </section>

      {/* Queue Action Error Banner */}
      {queueError && (
        <div
          role="alert"
          data-testid="controller-queue-error"
          className="min-w-0 max-w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium break-words [overflow-wrap:anywhere] text-rose-900"
        >
          {queueError}
        </div>
      )}

      {/* Focus-First Male & Female Queues */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <QueueColumn
          sex="M"
          entries={snapshot.entries}
          mode="controller"
          nextEntryId={snapshot.nextBySex.M}
          busyEntryIds={busyEntryIds}
          onEntryAction={(entryId, action) => {
            void handleEntryAction(entryId, action);
          }}
          onReorder={(entryId, direction) => {
            void handleReorder(entryId, direction);
          }}
        />
        <QueueColumn
          sex="F"
          entries={snapshot.entries}
          mode="controller"
          nextEntryId={snapshot.nextBySex.F}
          busyEntryIds={busyEntryIds}
          onEntryAction={(entryId, action) => {
            void handleEntryAction(entryId, action);
          }}
          onReorder={(entryId, direction) => {
            void handleReorder(entryId, direction);
          }}
        />
      </div>
    </div>
  );
}
