"use client";

import type { UsePushNotificationsResult } from "@/lib/client/usePushNotifications";
import { BellIcon, BellOffIcon } from "./Icons";

interface PushAlertsButtonProps {
  push: UsePushNotificationsResult;
}

export function PushAlertsButton({ push }: PushAlertsButtonProps) {
  if (!push.supported || !push.vapidConfigured) {
    return null;
  }

  const isDenied = push.permission === "denied";
  const label = push.isSubscribed
    ? "Push On"
    : isDenied
      ? "Blocked"
      : "Push";

  const title = push.isSubscribed
    ? "Background Push Alerts On (tap to turn off)"
    : isDenied
      ? "Notifications blocked in browser settings"
      : "Enable Background & Lock-Screen Push Alerts";

  return (
    <button
      type="button"
      data-testid="push-alerts-button"
      onClick={() => void push.togglePush()}
      disabled={push.isBusy || isDenied}
      aria-pressed={push.isSubscribed}
      aria-label={title}
      title={title}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
        push.isSubscribed
          ? "bg-emerald-700 text-white hover:bg-emerald-800"
          : isDenied
            ? "bg-rose-100 text-rose-900"
            : "bg-slate-100 text-slate-800 hover:bg-slate-200"
      }`}
    >
      {isDenied ? (
        <BellOffIcon className="h-4 w-4" />
      ) : (
        <BellIcon className="h-4 w-4" />
      )}
      <span>{label}</span>
    </button>
  );
}

export function PushAlertsNotice({ push }: PushAlertsButtonProps) {
  if (!push.isIosBrowserNotStandalone && !push.error) {
    return null;
  }

  return (
    <div className="mt-2.5 space-y-1.5">
      {push.isIosBrowserNotStandalone && (
        <div
          data-testid="ios-pwa-hint"
          className="min-w-0 max-w-full rounded-2xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900"
        >
          iPhone / iPad lock-screen alerts: tap{" "}
          <span className="font-semibold">Share → Add to Home Screen</span>,
          open ExamQ from Home Screen, then tap{" "}
          <span className="font-semibold">Push</span>.
        </div>
      )}
      {push.error && (
        <div
          role="status"
          data-testid="push-alerts-error"
          className="min-w-0 max-w-full rounded-2xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
        >
          {push.error}
        </div>
      )}
    </div>
  );
}
