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

export function ControllerDashboard({
  sessionId,
  controllerKey,
  snapshot,
  syncError,
  lastSyncedAtMs,
  alert,
  onMutationSnapshot,
}: ControllerDashboardProps) {
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
      <div className="mx-auto max-w-5xl space-y-3 rounded-xl border border-slate-200 bg-white p-6 text-center text-sm break-words [overflow-wrap:anywhere] text-slate-600">
        <p>Loading controller dashboard for session {sessionId}...</p>
        {syncError && (
          <div
            role="alert"
            data-testid="initial-sync-error"
            className="min-w-0 max-w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs break-words [overflow-wrap:anywhere] text-amber-900"
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
        text: "Please enter a valid exam start time.",
      });
      return;
    }

    const duration = Number(activeConfig.durationMinutes);
    if (!Number.isFinite(duration) || duration < 1) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Exam duration must be at least 1 minute.",
      });
      return;
    }

    const offsetMins = Number(activeConfig.offsetMinutes || "0");
    if (!Number.isFinite(offsetMins)) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Clock offset minutes must be a valid number.",
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
          text: "Exam configuration saved.",
        });
      });
    } catch (err) {
      setConfigMessageState({
        clearedSeq: latestClearedSeqRef.current,
        tone: "error",
        text:
          err instanceof ApiClientError
            ? err.message
            : "Failed to save exam configuration.",
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
        text: "Please enter a student number.",
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
          text: `Added ${sexToSubmit === "M" ? "Male" : "Female"} #${res.entry.studentNumber}${res.entry.override ? " (Override)" : ""}.`,
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
          text: "Session cleared across all connected clients.",
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 max-w-full space-y-1">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                Controller Dashboard
              </h1>
              <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-semibold text-white">
                Controller
              </span>
              <span className="max-w-full rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold break-all text-slate-700">
                {sessionId}
              </span>
              <span
                data-testid="window-status-badge"
                data-window-status={snapshot.windowStatus}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${windowBadgeClasses(
                  windowMeta.tone,
                )}`}
              >
                {windowMeta.label}
              </span>
            </div>
            <p className="text-sm text-slate-600">
              Effective Exam Time:{" "}
              <span className="font-mono font-medium text-slate-900">
                {formatTimeOnly(snapshot.effectiveNowMs)}
              </span>{" "}
              · Staff Connected:{" "}
              <span className="font-semibold text-slate-900">
                {snapshot.staff.length}
              </span>
              {lastSyncedAtMs !== null ? " · Live Sync" : ""}
            </p>
          </div>
        </div>

        {syncError && (
          <div
            role="status"
            className="mt-3 min-w-0 max-w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs break-words [overflow-wrap:anywhere] text-amber-900"
          >
            Sync warning: {syncError} (retrying automatically)
          </div>
        )}
      </header>

      {/* Alert Banner & Share QR Card */}
      <AlertBanner
        activeAlert={alert.activeAlert}
        muted={alert.muted}
        audioAlertCount={alert.audioAlertCount}
        vibrateAlertCount={alert.vibrateAlertCount}
        lastAlertSeq={alert.lastAlertSeq}
        onToggleMute={alert.toggleMute}
        onDismiss={alert.dismissAlert}
      />

      <QrShareCard sessionId={sessionId} />

      {/* Exam Time-Window Config + Controller Override Add Student */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Exam Configuration */}
        <section
          aria-label="Exam Time-Window Configuration"
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5"
        >
          <h2 className="text-base font-semibold text-slate-900">
            Exam Time-Window Settings
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Staff submissions are permitted after the first 30 minutes and
            before the last 20 minutes.
          </p>

          <div
            className={`mt-3 min-w-0 max-w-full rounded-lg border px-3 py-2 text-xs font-medium break-words [overflow-wrap:anywhere] ${windowBadgeClasses(
              windowMeta.tone,
            )}`}
          >
            <span className="font-bold">{windowMeta.label}:</span>{" "}
            {windowMeta.description}
          </div>

          <form
            onSubmit={(e) => {
              void handleSaveConfig(e);
            }}
            className="mt-4 space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="exam-start-time"
                  className="text-sm font-medium text-slate-800"
                >
                  Exam Start Time
                </label>
                <button
                  type="button"
                  onClick={() =>
                    updateDraft({
                      startLocal: toDateTimeLocalValue(snapshot.serverNowMs),
                      exactStartMs: snapshot.serverNowMs,
                    })
                  }
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Set Start = Now
                </button>
              </div>
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
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="exam-duration-minutes"
                  className="text-sm font-medium text-slate-800"
                >
                  Duration (minutes)
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
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="exam-clock-offset"
                  className="text-sm font-medium text-slate-800"
                >
                  Clock Offset (minutes)
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
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-600">
                Quick Clock Offset:
              </span>
              {[-35, 0, 35, 105].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => updateDraft({ offsetMinutes: String(mins) })}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  {mins > 0 ? `+${mins}m` : `${mins}m`}
                </button>
              ))}
            </div>

            {showShortDurationWarning && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Duration of 50 minutes or less has no allowed middle window
                (first 30m + last 20m).
              </p>
            )}

            {configMessage && (
              <div
                role={configMessage.tone === "error" ? "alert" : "status"}
                className={`min-w-0 max-w-full rounded-lg border px-3 py-2 text-sm break-words [overflow-wrap:anywhere] ${
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
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {savingConfig ? "Saving..." : "Save Exam Config"}
            </button>
          </form>
        </section>

        {/* Controller Add / Override Student */}
        <section
          aria-label="Controller Add Student"
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5"
        >
          <h2 className="text-base font-semibold text-slate-900">
            Controller Add Student &amp; Override
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Add a student directly or enable Controller Override to bypass the
            exam time-window check when adding or marking Enter Bathroom.
          </p>

          <form
            onSubmit={(e) => {
              void handleAddStudent(e);
            }}
            className="mt-4 space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-slate-800">
                Student Sex
              </span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  aria-pressed={addSex === "M"}
                  onClick={() => setAddSex("M")}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    addSex === "M"
                      ? "border-sky-600 bg-sky-600 text-white"
                      : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  Male
                </button>
                <button
                  type="button"
                  aria-pressed={addSex === "F"}
                  onClick={() => setAddSex("F")}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    addSex === "F"
                      ? "border-fuchsia-600 bg-fuchsia-600 text-white"
                      : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  Female
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="controller-student-number"
                className="block text-sm font-medium text-slate-800"
              >
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
                placeholder="e.g. 2001"
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
              />
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900">
              <input
                type="checkbox"
                checked={overrideEnabled}
                onChange={(e) => setOverrideEnabled(e.target.checked)}
                className="h-7 w-7 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              <span>
                Controller Override (allow adding &amp; entering outside time
                window)
              </span>
            </label>

            {studentMessage && (
              <div
                role={studentMessage.tone === "error" ? "alert" : "status"}
                data-testid="controller-add-message"
                className={`min-w-0 max-w-full rounded-lg border px-3 py-2 text-sm break-words [overflow-wrap:anywhere] ${
                  studentMessage.tone === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {studentMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submittingStudent}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {submittingStudent ? "Adding..." : "Add Student"}
            </button>
          </form>
        </section>
      </div>

      {/* Queue Action Error Banner */}
      {queueError && (
        <div
          role="alert"
          data-testid="controller-queue-error"
          className="min-w-0 max-w-full rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium break-words [overflow-wrap:anywhere] text-rose-900"
        >
          {queueError}
        </div>
      )}

      {/* Male & Female Queues */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

      {/* Connected Staff Roster & Clear Session */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          aria-label="Connected Staff"
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5"
        >
          <h2 className="text-base font-semibold text-slate-900">
            Connected Staff ({snapshot.staff.length})
          </h2>
          {snapshot.staff.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No roaming staff have joined yet. Share the link or QR code above.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {snapshot.staff.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 max-w-full font-medium break-words [overflow-wrap:anywhere] text-slate-900">
                    {member.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    Joined {formatTimeOnly(member.joinedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="End of Session Controls"
          className="min-w-0 rounded-xl border border-rose-200 bg-white p-4 shadow-xs sm:p-5"
        >
          <h2 className="text-base font-semibold text-slate-900">
            Clear Session
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Wipe all queued, active, and completed student entries across all
            connected clients when the exam session finishes.
          </p>

          {clearMessage && (
            <div
              role={clearMessage.tone === "error" ? "alert" : "status"}
              className={`mt-3 min-w-0 max-w-full rounded-lg border px-3 py-2 text-sm break-words [overflow-wrap:anywhere] ${
                clearMessage.tone === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {clearMessage.text}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {!confirmingClear ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmingClear(true);
                  setClearMessage(null);
                }}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-300 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                Clear Session
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={clearingSession}
                  onClick={() => {
                    void handleClearSession();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
                >
                  {clearingSession ? "Clearing..." : "Confirm Clear"}
                </button>
                <button
                  type="button"
                  disabled={clearingSession}
                  onClick={() => setConfirmingClear(false)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
