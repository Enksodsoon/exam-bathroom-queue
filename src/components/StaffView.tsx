"use client";

import { useRef, useState, type FormEvent } from "react";
import type { EntryAction, SessionSnapshot, Sex } from "@/lib/domain/types";
import {
  ApiClientError,
  acknowledgeAlert,
  applyEntryAction,
  postUndo,
  submitEntry,
} from "@/lib/client/api";
import type { StoredStaffIdentity } from "@/lib/client/storage";
import {
  describeWindowStatus,
  formatTimeOnly,
  windowBadgeClasses,
} from "@/lib/client/format";
import type { UseNextStudentAlertResult } from "@/lib/client/useNextStudentAlert";
import { usePushNotifications } from "@/lib/client/usePushNotifications";
import { AlertBanner } from "./AlertBanner";
import { useAppPreferences } from "./AppPreferencesProvider";
import { DualQueueSummaryStrip } from "./DualQueueSummaryStrip";
import { ExamTimelineBar } from "./ExamTimelineBar";
import {
  ArrowRightIcon,
  BellIcon,
  BellOffIcon,
  FemaleIcon,
  LockIcon,
  MaleIcon,
  UserBadgeIcon,
} from "./Icons";
import { PushAlertsButton, PushAlertsNotice } from "./PushAlertsButton";
import { QueueColumn } from "./QueueColumn";
import { ThemeLangToggle } from "./ThemeLangToggle";

interface StaffViewProps {
  sessionId: string;
  staffIdentity: StoredStaffIdentity;
  snapshot: SessionSnapshot | null;
  syncError: string | null;
  syncStale?: boolean;
  lastSyncedAtMs: number | null;
  lastSyncedAgeSeconds?: number | null;
  alert: UseNextStudentAlertResult;
  onMutationSnapshot: (snapshot: SessionSnapshot) => void;
  onChangeName: () => void;
}

const MAX_STUDENT_NUM_LEN = 32;

export function StaffView({
  sessionId,
  staffIdentity,
  snapshot,
  syncError,
  syncStale = false,
  lastSyncedAtMs,
  lastSyncedAgeSeconds = null,
  alert,
  onMutationSnapshot,
  onChangeName,
}: StaffViewProps) {
  const { locale, t } = useAppPreferences();
  const [sex, setSex] = useState<Sex>("M");
  const [studentNumber, setStudentNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [busyEntryIds, setBusyEntryIds] = useState<Set<string>>(() => new Set());
  const busyEntryIdsRef = useRef<Set<string>>(new Set());
  const [submitErrorState, setSubmitErrorState] = useState<{
    clearedSeq: number;
    text: string;
  } | null>(null);
  const [submitSuccessState, setSubmitSuccessState] = useState<{
    clearedSeq: number;
    text: string;
  } | null>(null);
  const push = usePushNotifications(sessionId, {
    staffToken: staffIdentity.staffToken,
  });

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 rounded-3xl border border-slate-200/90 bg-white p-8 text-center text-sm break-words [overflow-wrap:anywhere] text-slate-500 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <p className="text-xs">{t.loading}…</p>
        {syncError && (
          <div
            role="alert"
            data-testid="initial-sync-error"
            className="min-w-0 max-w-full rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs break-words [overflow-wrap:anywhere] text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
          >
            {t.reconnecting}
          </div>
        )}
      </div>
    );
  }

  const currentClearedSeq = snapshot.clearedSeq;
  const submitError =
    submitErrorState && submitErrorState.clearedSeq === currentClearedSeq
      ? submitErrorState.text
      : null;
  const submitSuccess =
    submitSuccessState && submitSuccessState.clearedSeq === currentClearedSeq
      ? submitSuccessState.text
      : null;

  const windowMeta = describeWindowStatus(snapshot.windowStatus, snapshot.examConfig, locale);
  const isAllowed = snapshot.windowStatus === "ALLOWED";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || syncStale) {
      return;
    }
    const trimmed = studentNumber.trim();
    if (!trimmed) {
      setSubmitErrorState({
        clearedSeq: currentClearedSeq,
        text: t.enterStudentError,
      });
      setSubmitSuccessState(null);
      return;
    }
    if (trimmed.length > MAX_STUDENT_NUM_LEN) {
      setSubmitErrorState({
        clearedSeq: currentClearedSeq,
        text: t.maxCharsError,
      });
      setSubmitSuccessState(null);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitErrorState(null);
    setSubmitSuccessState(null);

    try {
      const res = await submitEntry(
        sessionId,
        {
          sex,
          studentNumber: trimmed,
          staffId: staffIdentity.staffId,
          submittedBy: staffIdentity.label,
        },
        staffIdentity.staffToken
          ? { staffToken: staffIdentity.staffToken }
          : undefined,
      );
      onMutationSnapshot(res.snapshot);
      setStudentNumber("");
      setSubmitSuccessState({
        clearedSeq: res.snapshot.clearedSeq,
        text: `${sex === "M" ? "♂" : "♀"} #${res.entry.studentNumber} ${t.addedStatus}`,
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSubmitErrorState({
          clearedSeq: currentClearedSeq,
          text: err.windowStatus && err.code === "OUTSIDE_TIME_WINDOW"
            ? describeWindowStatus(err.windowStatus, snapshot.examConfig, locale).description
            : err.message,
        });
      } else {
        setSubmitErrorState({
          clearedSeq: currentClearedSeq,
          text: t.failedSubmitError,
        });
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleEntryAction = async (entryId: string, action: EntryAction) => {
    if (!staffIdentity.staffToken || busyEntryIdsRef.current.has(entryId)) {
      return;
    }
    busyEntryIdsRef.current.add(entryId);
    setBusyEntryIds(new Set(busyEntryIdsRef.current));
    setSubmitErrorState(null);
    try {
      const res = await applyEntryAction(
        sessionId,
        { staffToken: staffIdentity.staffToken },
        entryId,
        action,
      );
      onMutationSnapshot(res.snapshot);
    } catch (err) {
      setSubmitErrorState({
        clearedSeq: snapshot?.clearedSeq ?? 0,
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

  const staffActorKey = `staff:${staffIdentity.staffId}`;
  const hasStaffUndo = Boolean(
    snapshot?.undoStack?.some(
      (u) =>
        u.actorKey === staffActorKey &&
        (u.action === "enter" || u.action === "return"),
    ),
  );

  const handleUndo = async () => {
    if (!staffIdentity.staffToken) return;
    setSubmitErrorState(null);
    try {
      const res = await postUndo(sessionId, {
        staffToken: staffIdentity.staffToken,
      });
      onMutationSnapshot(res.snapshot);
    } catch (err) {
      setSubmitErrorState({
        clearedSeq: snapshot?.clearedSeq ?? 0,
        text:
          err instanceof ApiClientError ? err.message : "Failed to undo.",
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Slim Staff Top Bar */}
      <header className="rounded-3xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
                  isAllowed ? "bg-emerald-500" : "bg-amber-500"
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

          <div className="flex flex-wrap items-center gap-2">
            {hasStaffUndo && (
              <button
                type="button"
                data-testid="undo-button"
                onClick={() => {
                  void handleUndo();
                }}
                aria-label={t.undoAria}
                title={t.undoAria}
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>{t.undoBtn}</span>
              </button>
            )}
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

            <button
              type="button"
              onClick={onChangeName}
              title={t.switchStaffTitle}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <UserBadgeIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span className="max-w-[120px] truncate">
                {staffIdentity.label}
              </span>
            </button>

            <ThemeLangToggle />
          </div>
        </div>

        <PushAlertsNotice push={push} />

        <span role="status" className="sr-only">
          {syncStale ? t.reconnectingNotice : ""}
        </span>
      </header>

      {/* Alert Telemetry & Floating Next-Up Spotlight */}
      <AlertBanner
        activeAlert={syncStale ? null : alert.activeAlert}
        muted={alert.muted}
        audioAlertCount={alert.audioAlertCount}
        vibrateAlertCount={alert.vibrateAlertCount}
        lastAlertSeq={alert.lastAlertSeq}
        onToggleMute={alert.toggleMute}
        onDismiss={alert.dismissAlert}
        onAcknowledge={(seq) => {
          void acknowledgeAlert(sessionId, seq, {
            staffToken: staffIdentity.staffToken,
          })
            .then((res) => onMutationSnapshot(res.snapshot))
            .catch(() => {});
        }}
        hideMuteControl
      />

      {/* Icon-First Quick Submit Card */}
      <section
        aria-label="Submit Student to Bathroom Queue"
        className="min-w-0 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        {syncStale && (
          <p
            id="staff-reconnect-help"
            data-testid="staff-reconnect-help"
            role="status"
            className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100"
          >
            <strong>{t.reconnectingStaffTitle}</strong>{" "}
            {t.reconnectingStaffBody}
          </p>
        )}
        {!isAllowed && (
          <div
            id="staff-window-block-notice"
            data-testid="staff-window-block-notice"
            className="mb-4 flex min-w-0 max-w-full items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-xs font-medium break-words [overflow-wrap:anywhere] text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
          >
            <LockIcon className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>
              {windowMeta.description}
            </span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed={sex === "M"}
              onClick={() => setSex("M")}
              className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border-2 px-4 py-2.5 text-sm font-semibold transition focus:ring-2 focus:ring-sky-400 focus:outline-none ${
                sex === "M"
                  ? "border-sky-500 bg-sky-500/12 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              <MaleIcon className="h-5 w-5" />
              <span>{t.male}</span>
            </button>
            <button
              type="button"
              aria-pressed={sex === "F"}
              onClick={() => setSex("F")}
              className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border-2 px-4 py-2.5 text-sm font-semibold transition focus:ring-2 focus:ring-rose-400 focus:outline-none ${
                sex === "F"
                  ? "border-rose-500 bg-rose-500/12 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              <FemaleIcon className="h-5 w-5" />
              <span>{t.female}</span>
            </button>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <label htmlFor="staff-student-number" className="sr-only">
              Student Number
            </label>
            <input
              id="staff-student-number"
              name="studentNumber"
              type="text"
              inputMode="text"
              maxLength={MAX_STUDENT_NUM_LEN}
              value={studentNumber}
              onChange={(e) => {
                setStudentNumber(e.target.value);
                if (submitError) {
                  setSubmitErrorState(null);
                }
              }}
              placeholder={t.studentNumberPlaceholder}
              className="min-h-[50px] flex-1 rounded-full border border-slate-200 bg-slate-50/70 px-5 py-2.5 font-mono text-base font-semibold text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-400 dark:focus:bg-slate-800"
            />
            <button
              type="submit"
              disabled={submitting || syncStale}
              aria-label="Submit Student"
              aria-describedby={
                syncStale
                  ? "staff-reconnect-help"
                  : !isAllowed
                    ? "staff-window-block-notice"
                    : undefined
              }
              className={`inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full px-7 py-2.5 text-sm font-semibold text-white transition focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-50 ${
                isAllowed
                  ? "bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  : "bg-slate-600 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
              }`}
            >
              <span>{submitting ? t.addingButton : t.submitButton}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>

          {submitError && (
            <div
              role="alert"
              data-testid="staff-submit-error"
              className="min-w-0 max-w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium break-words [overflow-wrap:anywhere] text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
            >
              {submitError}
            </div>
          )}

          {submitSuccess && (
            <div
              role="status"
              className="min-w-0 max-w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium break-words [overflow-wrap:anywhere] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            >
              {submitSuccess}
            </div>
          )}
        </form>
      </section>

      {/* Simultaneous Male & Female Summary Strip */}
      <DualQueueSummaryStrip
        entries={snapshot.entries}
        nextBySex={snapshot.nextBySex}
      />

      {/* Live Queues (Staff can mark Enter / Returned, not reorder/remove) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QueueColumn
          sex="M"
          entries={snapshot.entries}
          mode="staff"
          nextEntryId={snapshot.nextBySex.M}
          busyEntryIds={busyEntryIds}
          onEntryAction={
            staffIdentity.staffToken
              ? (entryId, action) => {
                  void handleEntryAction(entryId, action);
                }
              : undefined
          }
        />
        <QueueColumn
          sex="F"
          entries={snapshot.entries}
          mode="staff"
          nextEntryId={snapshot.nextBySex.F}
          busyEntryIds={busyEntryIds}
          onEntryAction={
            staffIdentity.staffToken
              ? (entryId, action) => {
                  void handleEntryAction(entryId, action);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
