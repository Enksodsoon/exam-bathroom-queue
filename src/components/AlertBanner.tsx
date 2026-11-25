"use client";

import type { AlertInfo } from "@/lib/domain/types";

interface AlertBannerProps {
  activeAlert: AlertInfo | null;
  muted: boolean;
  audioAlertCount: number;
  vibrateAlertCount: number;
  lastAlertSeq: number;
  onToggleMute: () => void;
  onDismiss: () => void;
}

export function AlertBanner({
  activeAlert,
  muted,
  audioAlertCount,
  vibrateAlertCount,
  lastAlertSeq,
  onToggleMute,
  onDismiss,
}: AlertBannerProps) {
  return (
    <div
      data-testid="alert-telemetry"
      data-audio-alert-count={audioAlertCount}
      data-vibrate-alert-count={vibrateAlertCount}
      data-last-alert-seq={lastAlertSeq}
      data-alerts-muted={String(muted)}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-xs">
        <div className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">Next-Student Alerts:</span>{" "}
          <span>{muted ? "Muted" : "Sound & Vibration On"}</span>
        </div>
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition focus:ring-2 focus:ring-slate-500 focus:outline-none ${
            muted
              ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
              : "border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100"
          }`}
        >
          {muted ? "Unmute Alerts" : "Mute Alerts"}
        </button>
      </div>

      {activeAlert && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="next-student-alert"
          className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-indigo-500 bg-indigo-50 px-4 py-3 text-indigo-950 shadow-sm"
        >
          <div className="min-w-0 max-w-full space-y-0.5">
            <p className="text-xs font-bold tracking-wide text-indigo-700 uppercase">
              Next Student Update
            </p>
            <p className="min-w-0 max-w-full text-base font-bold break-words [overflow-wrap:anywhere]">
              NEXT {activeAlert.sex === "M" ? "MALE" : "FEMALE"}: #
              {activeAlert.studentNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-900 transition hover:bg-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
