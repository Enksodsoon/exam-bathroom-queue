"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FIRST_BLOCK_MINUTES, LAST_BLOCK_MINUTES, MAX_BLOCK_MINUTES, getExamBlockMinutes, isValidExamBlockMinutes } from "@/lib/domain/window";
import type { EntryAction, SessionSnapshot, Sex } from "@/lib/domain/types";
import {
  ApiClientError,
  applyEntryAction,
  clearSession,
  reorderEntry,
  rotateInvite,
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
import { usePushNotifications } from "@/lib/client/usePushNotifications";
import { AlertBanner } from "./AlertBanner";
import { useAppPreferences } from "./AppPreferencesProvider";
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
import { PushAlertsButton, PushAlertsNotice } from "./PushAlertsButton";
import { QrShareCard } from "./QrShareCard";
import { QueueColumn } from "./QueueColumn";
import { ThemeLangToggle } from "./ThemeLangToggle";

interface ControllerDashboardProps {
  sessionId: string;
  controllerKey: string;
  snapshot: SessionSnapshot | null;
  syncError: string | null;
  syncStale?: boolean;
  lastSyncedAtMs: number | null;
  lastSyncedAgeSeconds?: number | null;
  alert: UseNextStudentAlertResult;
  onMutationSnapshot: (snapshot: SessionSnapshot) => void;
}

interface ConfigDraft {
  startLocal: string;
  exactStartMs: number | null;
  durationMinutes: string;
  offsetMinutes: string;
  firstBlockMinutes: string;
  lastBlockMinutes: string;
}

type ActiveDrawer = "timer" | "qr" | "staff" | null;

export function ControllerDashboard({
  sessionId,
  controllerKey,
  snapshot,
  syncError,
  syncStale = false,
  lastSyncedAtMs,
  lastSyncedAgeSeconds = null,
  alert,
  onMutationSnapshot,
}: ControllerDashboardProps) {
  const { locale, t } = useAppPreferences();
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
  const push = usePushNotifications(sessionId, { controllerKey });
  const timerBtnRef = useRef<HTMLButtonElement | null>(null);
  const qrBtnRef = useRef<HTMLButtonElement | null>(null);
  const staffBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastDrawerRef = useRef<ActiveDrawer>(null);
  const [rotatingInvite, setRotatingInvite] = useState(false);
  const [confirmShortDuration, setConfirmShortDuration] = useState(false);
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
        <p className="text-xs">Connecting…</p>
        {syncError && (
          <div
            role="alert"
            data-testid="initial-sync-error"
            className="min-w-0 max-w-full rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs break-words [overflow-wrap:anywhere] text-amber-900"
          >
            Reconnecting…
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

  const windowMeta = describeWindowStatus(snapshot.windowStatus, snapshot.examConfig, locale);

  const savedBlocks = getExamBlockMinutes(snapshot.examConfig);
  const baseConfigValues: ConfigDraft = snapshot.examConfig
    ? {
        startLocal: toDateTimeLocalValue(snapshot.examConfig.startTimeMs),
        exactStartMs: snapshot.examConfig.startTimeMs,
        durationMinutes: String(snapshot.examConfig.durationMinutes),
        firstBlockMinutes: String(savedBlocks.first),
        lastBlockMinutes: String(savedBlocks.last),
        offsetMinutes: String(
          Math.round((snapshot.examConfig.clockOffsetMs ?? 0) / 60_000),
        ),
      }
    : {
        startLocal: toDateTimeLocalValue(snapshot.serverNowMs),
        exactStartMs: null,
        durationMinutes: "120",
        offsetMinutes: "0",
        firstBlockMinutes: String(FIRST_BLOCK_MINUTES),
        lastBlockMinutes: String(LAST_BLOCK_MINUTES),
      };

  const activeConfig = configDraft ?? baseConfigValues;
  const parsedDurationNum = Number(activeConfig.durationMinutes);
  const firstBlock = Number(activeConfig.firstBlockMinutes);
  const lastBlock = Number(activeConfig.lastBlockMinutes);
  const blocksValid = activeConfig.firstBlockMinutes !== "" && activeConfig.lastBlockMinutes !== "" &&
    isValidExamBlockMinutes(firstBlock) && isValidExamBlockMinutes(lastBlock);
  const openMinutes = Number.isInteger(parsedDurationNum) && parsedDurationNum >= 1 && blocksValid
    ? Math.max(0, parsedDurationNum - firstBlock - lastBlock)
    : null;
  const showShortDurationWarning = openMinutes === 0;

  const updateDraft = (patch: Partial<ConfigDraft>) => {
    if (patch.durationMinutes !== undefined || patch.firstBlockMinutes !== undefined ||
      patch.lastBlockMinutes !== undefined) setConfirmShortDuration(false);
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
    if (
      !Number.isFinite(duration) ||
      !Number.isInteger(duration) ||
      duration < 1
    ) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Use whole minutes (1 or more).",
      });
      return;
    }

    if (!blocksValid) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: `Use whole minutes from 0 to ${MAX_BLOCK_MINUTES} minutes.`,
      });
      return;
    }

    if (showShortDurationWarning && !confirmShortDuration) {
      setConfigMessageState({
        clearedSeq: currentClearedSeq,
        tone: "error",
        text: "Confirm that there is no normal bathroom window before saving.",
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
          firstBlockMinutes: firstBlock,
          lastBlockMinutes: lastBlock,
          clockOffsetMs: Math.round(offsetMins * 60_000),
        });
        onMutationSnapshot(res.snapshot);
        setConfigDraft(null);
        setConfirmShortDuration(false);
        setConfigMessageState({
          clearedSeq: res.snapshot.clearedSeq,
          tone: "success",
          text: t.timerSaved,
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
          controllerKey,
        );
        onMutationSnapshot(res.snapshot);
        setAddStudentNumber("");
        if (useOverride) {
          setOverrideEnabled(false);
        }
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
        if (useOverride) {
          setOverrideEnabled(false);
        }
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

  const handleClearSession = async (force = false) => {
    if (clearingSessionRef.current) {
      return;
    }
    clearingSessionRef.current = true;
    setClearingSession(true);
    setClearMessage(null);
    setQueueErrorState(null);
    try {
      await enqueueMutation(async () => {
        const res = await clearSession(sessionId, controllerKey, { force });
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

  const handleRotateInvite = async () => {
    if (rotatingInvite) {
      return;
    }
    setRotatingInvite(true);
    try {
      await enqueueMutation(async () => {
        const res = await rotateInvite(sessionId, controllerKey);
        onMutationSnapshot(res.snapshot);
      });
    } catch (err) {
      setQueueErrorState({
        clearedSeq: latestClearedSeqRef.current,
        text:
          err instanceof ApiClientError
            ? err.message
            : "Failed to rotate join link.",
      });
    } finally {
      setRotatingInvite(false);
    }
  };

  const closeDrawer = () => {
    const prev = lastDrawerRef.current;
    setActiveDrawer(null);
    lastDrawerRef.current = null;
    queueMicrotask(() => {
      if (prev === "timer") timerBtnRef.current?.focus();
      else if (prev === "qr") qrBtnRef.current?.focus();
      else if (prev === "staff") staffBtnRef.current?.focus();
    });
  };

  const toggleDrawer = (drawer: Exclude<ActiveDrawer, null>) => {
    if (activeDrawer === drawer) {
      closeDrawer();
      return;
    }
    lastDrawerRef.current = drawer;
    setActiveDrawer(drawer);
  };

  const showTestClock =
    process.env.NEXT_PUBLIC_VERCEL_ENV !== "production" ||
    process.env.NEXT_PUBLIC_EXAMQ_TEST_CLOCK === "1";

  const activeInBathroom = snapshot.entries.filter(
    (entry) => entry.status === "in_bathroom",
  );

  return (
    <div className="space-y-4">
      {/* Slim Focus-First Top Bar */}
      <header className="rounded-3xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
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

            <span className="font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
              {formatTimeOnly(snapshot.effectiveNowMs)}
            </span>

            {syncStale ? (
              <span
                data-testid="sync-stale-badge"
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                {t.reconnectingShort}
                {lastSyncedAgeSeconds !== null
                  ? ` · ${lastSyncedAgeSeconds}s`
                  : ""}
              </span>
            ) : (
              lastSyncedAtMs !== null && (
                <span
                  title={t.liveSync}
                  className="h-2 w-2 rounded-full bg-emerald-700 dark:bg-emerald-400"
                />
              )
            )}
          </div>

          {/* Single-Tap Icon Triggers */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              ref={timerBtnRef}
              type="button"
              onClick={() => toggleDrawer("timer")}
              aria-expanded={activeDrawer === "timer"}
              aria-label="Exam Timer Settings"
              title={t.timerAria}
              className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
                activeDrawer === "timer"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <ClockIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.timerButton}</span>
            </button>

            <button
              ref={qrBtnRef}
              type="button"
              onClick={() => toggleDrawer("qr")}
              aria-expanded={activeDrawer === "qr"}
              aria-label="Share QR Code"
              title={t.qrAria}
              className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
                activeDrawer === "qr"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <QrIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.qrButton}</span>
            </button>

            <button
              ref={staffBtnRef}
              type="button"
              onClick={() => toggleDrawer("staff")}
              aria-expanded={activeDrawer === "staff"}
              aria-label="Connected Staff"
              title={t.staffDrawerTitle}
              className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
                activeDrawer === "staff"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <UsersIcon className="h-4 w-4" />
              <span className="font-mono tabular-nums">
                {snapshot.staff.length}
              </span>
            </button>

            <PushAlertsButton push={push} />

            <button
              type="button"
              onClick={alert.toggleMute}
              aria-pressed={alert.muted}
              aria-label={alert.muted ? "Unmute Alerts" : "Mute Alerts"}
              title={alert.muted ? t.unmuteAlerts : t.muteAlerts}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition ${
                alert.muted
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/70 dark:text-amber-200"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
                title={t.clearSessionAria}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600 transition hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60"
              >
                <ResetIcon className="h-4 w-4" />
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-rose-50 p-1 dark:bg-rose-950/60">
                {activeInBathroom.length > 0 && (
                  <span className="px-2 text-[11px] font-semibold text-rose-900 dark:text-rose-200">
                    {t.outPrefix}{" "}
                    {activeInBathroom
                      .map((e) => `#${e.studentNumber}`)
                      .join(", ")}
                  </span>
                )}
                <button
                  type="button"
                  disabled={clearingSession}
                  onClick={() => {
                    void handleClearSession(activeInBathroom.length > 0);
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-rose-700 px-3.5 text-xs font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
                >
                  {clearingSession
                    ? "..."
                    : activeInBathroom.length > 0
                      ? t.forceClear
                      : t.confirmClear}
                </button>
                <button
                  type="button"
                  disabled={clearingSession}
                  onClick={() => setConfirmingClear(false)}
                  aria-label="Cancel"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <ThemeLangToggle />
          </div>
        </div>

        <PushAlertsNotice push={push} onTestTabAlert={alert.testTabAlert} />

        <span role="status" className="sr-only">
          {syncStale ? t.reconnectingNotice : ""}
        </span>

        {clearMessage && (
          <div
            role={clearMessage.tone === "error" ? "alert" : "status"}
            className={`mt-2.5 min-w-0 max-w-full rounded-2xl border px-3 py-1.5 text-xs font-medium break-words [overflow-wrap:anywhere] ${
              clearMessage.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            }`}
          >
            {clearMessage.text}
          </div>
        )}
      </header>

      {!syncStale && (!snapshot.examConfig || snapshot.staff.length === 0) && (
        <section
          aria-label="Exam setup"
          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-3 dark:border-emerald-800/70 dark:bg-emerald-950/50"
        >
          <div>
            <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
              {snapshot.examConfig ? t.setupStep2Title : t.setupStep1Title}
            </p>
            <p className="mt-0.5 text-sm text-emerald-900 dark:text-emerald-200">
              {snapshot.examConfig ? t.setupStep2Body : t.setupStep1Body}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const button = snapshot.examConfig ? qrBtnRef.current : timerBtnRef.current;
              const drawer = snapshot.examConfig ? "qr" : "timer";
              if (activeDrawer !== drawer) toggleDrawer(drawer);
              button?.focus();
            }}
            className="inline-flex min-h-[44px] items-center rounded-full bg-emerald-900 px-5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {snapshot.examConfig ? t.setupStep2Btn : t.setupStep1Btn}
          </button>
        </section>
      )}

      {/* Top-Bar Drawers (Timer / QR / Staff) */}
      {activeDrawer === "timer" && (
        <section
          aria-label="Exam Time-Window Configuration"
          className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t.timerDrawerTitle}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close Timer"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
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
                className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-emerald-500/12 px-3.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-300"
              >
                {t.setStartNow}
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
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {mins}m
                </button>
              ))}
              {showTestClock &&
                [-35, 0, 35, 105].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => updateDraft({ offsetMinutes: String(mins) })}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-mono font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {mins > 0 ? `+${mins}m` : `${mins}m`}
                  </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="exam-start-time"
                  className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                >
                  {t.startTimeLabel}
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
                  className="min-h-[44px] w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label
                  htmlFor="exam-duration-minutes"
                  className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                >
                  {t.durationMinLabel}
                </label>
                <input
                  id="exam-duration-minutes"
                  name="durationMinutes"
                  type="number"
                  min={1}
                  step={1}
                  value={activeConfig.durationMinutes}
                  onChange={(e) => {
                    updateDraft({ durationMinutes: e.target.value });
                    setConfirmShortDuration(false);
                  }}
                  className="min-h-[44px] w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400"
                />
              </div>

              {showTestClock && (
                <div>
                  <label
                    htmlFor="exam-clock-offset"
                    className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                  >
                    {t.offsetMinLabel}
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
                    className="min-h-[44px] w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400"
                  />
                </div>
              )}
            </div>

            <fieldset className="space-y-2 rounded-2xl border border-slate-200 px-3 pb-3 dark:border-slate-700">
              <legend className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-300">{t.blocksLegend}</legend>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["firstBlockMinutes", t.blockFirstLabel],
                  ["lastBlockMinutes", t.blockLastLabel],
                ] as const).map(([field, label]) => (
                  <label key={field} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={MAX_BLOCK_MINUTES}
                      step={1}
                      value={activeConfig[field]}
                      onChange={(e) => updateDraft({ [field]: e.target.value })}
                      className="mt-1 block min-h-[44px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-950 focus:outline-2 focus:outline-offset-2 focus:outline-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {openMinutes !== null && <>{t.normalWindowLabel} <strong>{openMinutes} min</strong>.</>}
                </p>
                <span className="text-xs text-slate-600 dark:text-slate-400">{t.blocksZeroHint}</span>
                <button type="button" onClick={() => updateDraft({
                  firstBlockMinutes: String(FIRST_BLOCK_MINUTES),
                  lastBlockMinutes: String(LAST_BLOCK_MINUTES),
                })} className="min-h-[44px] px-2 text-xs font-medium text-slate-700 underline dark:text-slate-300">
                  {t.resetBlocksBtn}
                </button>
              </div>
            </fieldset>

            {showShortDurationWarning && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={confirmShortDuration}
                  onChange={(e) => setConfirmShortDuration(e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-amber-400 text-amber-800"
                />
                <span>
                  {t.confirmOverrideOnlyLabel}
                </span>
              </label>
            )}

            {configMessage && (
              <div
                role={configMessage.tone === "error" ? "alert" : "status"}
                className={`min-w-0 max-w-full rounded-2xl border px-3 py-2 text-xs font-medium break-words [overflow-wrap:anywhere] ${
                  configMessage.tone === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                }`}
              >
                {configMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={savingConfig}
              aria-label="Save Exam Config"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {savingConfig ? t.savingConfig : t.saveExamConfig}
            </button>
          </form>
        </section>
      )}

      {activeDrawer === "qr" && (
        <QrShareCard
          sessionId={sessionId}
          inviteCode={snapshot.inviteCode}
          rotatingInvite={rotatingInvite}
          onRotateInvite={() => {
            void handleRotateInvite();
          }}
        />
      )}

      {activeDrawer === "staff" && (
        <section
          aria-label="Checked In Staff"
          className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.staffDrawerTitle} ({snapshot.staff.length})
            </h2>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close Staff List"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          {snapshot.staff.length === 0 ? (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t.noStaffJoined}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {snapshot.staff.map((member) => (
                <span
                  key={member.id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-700 dark:bg-emerald-400" />
                  <span className="max-w-[160px] truncate">{member.label}</span>
                  <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
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
        activeAlert={syncStale ? null : alert.activeAlert}
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
        className="rounded-3xl border border-slate-200/90 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <form
          onSubmit={(e) => {
            void handleAddStudent(e);
          }}
          className="flex flex-wrap items-center gap-2"
          noValidate
        >
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              aria-pressed={addSex === "M"}
              aria-label="Male"
              onClick={() => setAddSex("M")}
              className={`inline-flex h-11 items-center gap-1 rounded-full px-3.5 text-xs font-semibold transition ${
                addSex === "M"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
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
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
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
            placeholder={t.studentNumberPlaceholder}
            className="min-h-[44px] min-w-[120px] flex-1 rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2 font-mono text-sm font-semibold text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-400"
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
                ? "border-purple-300 bg-purple-100 text-purple-800 dark:border-purple-700 dark:bg-purple-950/70 dark:text-purple-200"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            <ShieldIcon className="h-3.5 w-3.5" />
            <span>{t.overrideLabel}</span>
          </button>

          <button
            type="submit"
            disabled={submittingStudent}
            aria-label="Add Student"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-slate-900 px-5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            <PlusIcon className="h-4 w-4" />
            <span>{submittingStudent ? "..." : t.addToQueueBtn}</span>
          </button>
        </form>

        {studentMessage && (
          <div
            role={studentMessage.tone === "error" ? "alert" : "status"}
            data-testid="controller-add-message"
            className={`mt-2.5 min-w-0 max-w-full rounded-2xl border px-3.5 py-2 text-xs font-medium break-words [overflow-wrap:anywhere] ${
              studentMessage.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
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
          className="min-w-0 max-w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium break-words [overflow-wrap:anywhere] text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
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
