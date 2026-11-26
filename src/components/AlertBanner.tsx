"use client";

import type { AlertInfo } from "@/lib/domain/types";
import { BellIcon, BellOffIcon, CloseIcon } from "./Icons";

interface AlertBannerProps {
  activeAlert: AlertInfo | null;
  muted: boolean;
  audioAlertCount: number;
  vibrateAlertCount: number;
  lastAlertSeq: number;
  onToggleMute: () => void;
  onDismiss: () => void;
  hideMuteControl?: boolean;
}

export function AlertBanner({
  activeAlert,
  muted,
  audioAlertCount,
  vibrateAlertCount,
  lastAlertSeq,
  onToggleMute,
  onDismiss,
  hideMuteControl = false,
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
      {!hideMuteControl && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-slate-200/90 bg-white px-4 py-1.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <span
              className={`h-2 w-2 rounded-full ${
                muted ? "bg-amber-400" : "bg-emerald-500"
              }`}
            />
            <span>{muted ? "Alerts Muted" : "Alerts Active"}</span>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute Alerts" : "Mute Alerts"}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
              muted
                ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {muted ? (
              <BellOffIcon className="h-3.5 w-3.5" />
            ) : (
              <BellIcon className="h-3.5 w-3.5" />
            )}
            <span>{muted ? "Unmute" : "Mute"}</span>
          </button>
        </div>
      )}

      {activeAlert && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="next-student-alert"
          className="flex min-w-0 max-w-full items-center justify-between gap-3 rounded-3xl border border-emerald-300 bg-emerald-50/90 px-4 py-3 text-emerald-950 shadow-xs"
        >
          <div className="flex min-w-0 max-w-full items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                activeAlert.sex === "M"
                  ? "bg-sky-500/15 text-sky-700"
                  : "bg-rose-500/15 text-rose-700"
              }`}
            >
              {activeAlert.sex === "M" ? "♂" : "♀"}
            </span>
            <div className="min-w-0 max-w-full">
              <p className="text-[11px] font-semibold tracking-wider text-emerald-700 uppercase">
                Next {activeAlert.sex === "M" ? "Male" : "Female"}
              </p>
              <p className="min-w-0 max-w-full font-mono text-base font-bold break-words [overflow-wrap:anywhere] tabular-nums">
                #{activeAlert.studentNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-emerald-800 shadow-2xs transition hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
