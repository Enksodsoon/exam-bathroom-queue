"use client";

import type { UsePushNotificationsResult } from "@/lib/client/usePushNotifications";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { useAppPreferences } from "./AppPreferencesProvider";
import { BellIcon, BellOffIcon } from "./Icons";

interface PushAlertsButtonProps {
  push: UsePushNotificationsResult;
}

export function PushAlertsButton({ push }: PushAlertsButtonProps) {
  const { t } = useAppPreferences();
  if (!push.supported || !push.vapidConfigured) {
    return null;
  }

  const isDenied = push.permission === "denied";
  const label = push.isSubscribed
    ? t.turnOffAlerts
    : isDenied
      ? t.pushBlocked
      : t.enableAlerts;

  const title = push.isSubscribed
    ? t.pushOnTitle
    : isDenied
      ? t.pushBlockedTitle
      : t.pushOffTitle;

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
            ? "bg-rose-100 text-rose-900 dark:bg-rose-950/70 dark:text-rose-200"
            : "bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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

export function PushAlertsNotice({
  push,
}: PushAlertsButtonProps) {
  const { t } = useAppPreferences();
  const wakeLock = useWakeLock();

  const statusText =
    push.pilotStatus === "test_sent"
      ? t.pushStatusTestSent
      : push.pilotStatus === "test_needed"
        ? t.pushStatusTestNeeded
        : push.pilotStatus === "unavailable"
          ? t.pushStatusUnavailable
          : t.pushStatusNotEnabled;

  const statusTone =
    push.pilotStatus === "test_sent"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200"
      : push.pilotStatus === "test_needed"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

  return (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
        <span
          data-testid="push-pilot-status"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusTone}`}
        >
          {statusText}
        </span>

        {push.isSubscribed && (
          <button
            type="button"
            data-testid="test-lock-screen-button"
            disabled={push.testState === "sending"}
            onClick={() => void push.testLockScreenAlert()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2.5 font-semibold text-sky-900 hover:bg-sky-50 focus-visible:outline-2 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
          >
            <BellIcon className="h-4 w-4" />
            <span>{t.testLockScreen}</span>
          </button>
        )}

        {wakeLock.supported && (
          <button
            type="button"
            data-testid="wake-lock-toggle"
            aria-pressed={wakeLock.active}
            onClick={() => void wakeLock.toggle()}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2.5 font-medium transition ${
              wakeLock.active
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <span>{wakeLock.active ? t.wakeLockOn : t.wakeLockOff}</span>
          </button>
        )}
      </div>

      {push.testState === "sent" && (
        <p
          role="status"
          data-testid="lock-screen-test-status"
          className="px-2 text-xs text-emerald-800 dark:text-emerald-300"
        >
          {t.testLockScreenSent}
        </p>
      )}

      {push.isIosBrowserNotStandalone && (
        <details
          data-testid="ios-pwa-hint"
          className="text-xs text-slate-600 dark:text-slate-400"
        >
          <summary className="min-h-[44px] cursor-pointer py-3 font-medium">
            {t.iosHelpButton}
          </summary>
          <p className="pb-2">{t.iosHelpHint}</p>
        </details>
      )}

      {push.error && (
        <div
          role="status"
          data-testid="push-alerts-error"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
        >
          {push.error}
        </div>
      )}
    </div>
  );
}
