"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SessionSnapshot, Sex } from "@/lib/domain/types";
import { ApiClientError, submitEntry } from "@/lib/client/api";
import type { StoredStaffIdentity } from "@/lib/client/storage";
import {
  describeWindowStatus,
  formatTimeOnly,
  windowBadgeClasses,
} from "@/lib/client/format";
import type { UseNextStudentAlertResult } from "@/lib/client/useNextStudentAlert";
import { AlertBanner } from "./AlertBanner";
import { QueueColumn } from "./QueueColumn";

interface StaffViewProps {
  sessionId: string;
  staffIdentity: StoredStaffIdentity;
  snapshot: SessionSnapshot | null;
  syncError: string | null;
  lastSyncedAtMs: number | null;
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
  lastSyncedAtMs,
  alert,
  onMutationSnapshot,
  onChangeName,
}: StaffViewProps) {
  const [sex, setSex] = useState<Sex>("M");
  const [studentNumber, setStudentNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitErrorState, setSubmitErrorState] = useState<{
    clearedSeq: number;
    text: string;
  } | null>(null);
  const [submitSuccessState, setSubmitSuccessState] = useState<{
    clearedSeq: number;
    text: string;
  } | null>(null);

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 rounded-xl border border-slate-200 bg-white p-6 text-center text-sm break-words [overflow-wrap:anywhere] text-slate-600">
        <p>Loading session {sessionId}...</p>
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
  const submitError =
    submitErrorState && submitErrorState.clearedSeq === currentClearedSeq
      ? submitErrorState.text
      : null;
  const submitSuccess =
    submitSuccessState && submitSuccessState.clearedSeq === currentClearedSeq
      ? submitSuccessState.text
      : null;

  const windowMeta = describeWindowStatus(snapshot.windowStatus);
  const isAllowed = snapshot.windowStatus === "ALLOWED";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const trimmed = studentNumber.trim();
    if (!trimmed) {
      setSubmitErrorState({
        clearedSeq: currentClearedSeq,
        text: "Please enter a student number.",
      });
      setSubmitSuccessState(null);
      return;
    }
    if (trimmed.length > MAX_STUDENT_NUM_LEN) {
      setSubmitErrorState({
        clearedSeq: currentClearedSeq,
        text: `Student number must be ${MAX_STUDENT_NUM_LEN} characters or fewer.`,
      });
      setSubmitSuccessState(null);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitErrorState(null);
    setSubmitSuccessState(null);

    try {
      const res = await submitEntry(sessionId, {
        sex,
        studentNumber: trimmed,
        staffId: staffIdentity.staffId,
        submittedBy: staffIdentity.label,
      });
      onMutationSnapshot(res.snapshot);
      setStudentNumber("");
      setSubmitSuccessState({
        clearedSeq: res.snapshot.clearedSeq,
        text: `Added ${sex === "M" ? "Male" : "Female"} #${res.entry.studentNumber} to queue.`,
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSubmitErrorState({
          clearedSeq: currentClearedSeq,
          text: err.message,
        });
      } else {
        setSubmitErrorState({
          clearedSeq: currentClearedSeq,
          text: "Failed to submit student. Please try again.",
        });
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 max-w-full space-y-1">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
                Exam Bathroom Queue
              </h1>
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
              Signed in as{" "}
              <span className="font-semibold break-words [overflow-wrap:anywhere] text-slate-900">
                {staffIdentity.label}
              </span>{" "}
              · Exam Clock:{" "}
              <span className="font-mono font-medium text-slate-800">
                {formatTimeOnly(snapshot.effectiveNowMs)}
              </span>
              {lastSyncedAtMs !== null ? " · Live Sync" : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={onChangeName}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
          >
            Change Name
          </button>
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

      {/* Alert Banner & Mute Control */}
      <AlertBanner
        activeAlert={alert.activeAlert}
        muted={alert.muted}
        audioAlertCount={alert.audioAlertCount}
        vibrateAlertCount={alert.vibrateAlertCount}
        lastAlertSeq={alert.lastAlertSeq}
        onToggleMute={alert.toggleMute}
        onDismiss={alert.dismissAlert}
      />

      {/* Quick Submit Card */}
      <section
        aria-label="Submit Student to Bathroom Queue"
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Add Student to Queue
          </h2>
          <span className="text-xs text-slate-500">
            FIFO queue by sex · 1 student per bathroom at a time
          </span>
        </div>

        {!isAllowed && (
          <div
            data-testid="staff-window-block-notice"
            className="mb-4 min-w-0 max-w-full rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm break-words [overflow-wrap:anywhere] text-rose-900"
          >
            <span className="font-semibold">
              Submissions Blocked ({windowMeta.label}):
            </span>{" "}
            {windowMeta.description}
          </div>
        )}

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-slate-800">
              Student Sex
            </span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                aria-pressed={sex === "M"}
                onClick={() => setSex("M")}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 py-2 text-base font-semibold transition focus:ring-2 focus:ring-sky-500 focus:outline-none ${
                  sex === "M"
                    ? "border-sky-600 bg-sky-600 text-white shadow-xs"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                Male
              </button>
              <button
                type="button"
                aria-pressed={sex === "F"}
                onClick={() => setSex("F")}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 py-2 text-base font-semibold transition focus:ring-2 focus:ring-fuchsia-500 focus:outline-none ${
                  sex === "F"
                    ? "border-fuchsia-600 bg-fuchsia-600 text-white shadow-xs"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                Female
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="staff-student-number"
              className="block text-sm font-medium text-slate-800"
            >
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
              placeholder="e.g. 1042"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
            />
          </div>

          {submitError && (
            <div
              role="alert"
              data-testid="staff-submit-error"
              className="min-w-0 max-w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm break-words [overflow-wrap:anywhere] text-rose-800"
            >
              {submitError}
            </div>
          )}

          {submitSuccess && (
            <div
              role="status"
              className="min-w-0 max-w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm break-words [overflow-wrap:anywhere] text-emerald-800"
            >
              {submitSuccess}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`inline-flex min-h-[48px] w-full items-center justify-center rounded-lg px-4 py-2.5 text-base font-semibold text-white transition focus:ring-2 focus:ring-slate-500 focus:outline-none disabled:opacity-50 ${
              isAllowed
                ? "bg-slate-900 hover:bg-slate-800"
                : "bg-slate-500 hover:bg-slate-600"
            }`}
          >
            {submitting ? "Submitting..." : "Submit Student"}
          </button>
        </form>
      </section>

      {/* Live Read-Only Queues */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QueueColumn
          sex="M"
          entries={snapshot.entries}
          mode="staff"
          nextEntryId={snapshot.nextBySex.M}
        />
        <QueueColumn
          sex="F"
          entries={snapshot.entries}
          mode="staff"
          nextEntryId={snapshot.nextBySex.F}
        />
      </div>
    </div>
  );
}
