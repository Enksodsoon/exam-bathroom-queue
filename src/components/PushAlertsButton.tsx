"use client";

import { useState } from "react";
import type { UsePushNotificationsResult } from "@/lib/client/usePushNotifications";
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
    ? t.pushOn
    : isDenied
      ? t.pushBlocked
      : t.pushOff;

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
  onTestTabAlert,
}: PushAlertsButtonProps & { onTestTabAlert: () => void }) {
  const { t } = useAppPreferences();
  const [testRan, setTestRan] = useState(false);
  return (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-700 dark:text-slate-300">
        <span>{t.liveInThisTab}</span>
        <button type="button" onClick={() => { onTestTabAlert(); setTestRan(true); }}
          aria-label="Test in-tab alert" title={t.testSoundTitle}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 font-semibold text-sky-900 focus-visible:outline-2 dark:text-sky-300">
          <BellIcon className="h-4 w-4" /> {t.testSound}
        </button>
      </div>
      {testRan && <p role="status" className="px-3 text-xs text-slate-700 dark:text-slate-300">
        {t.testAlertRan}
      </p>}
      {push.isIosBrowserNotStandalone && (
        <details data-testid="ios-pwa-hint" className="text-xs text-slate-600 dark:text-slate-400">
          <summary className="min-h-[44px] cursor-pointer py-3 font-medium">{t.iosHelpButton}</summary>
          <p className="pb-2">{t.iosHelpHint}</p>
        </details>
      )}
      {push.error && (
        <div role="status" data-testid="push-alerts-error"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          {push.error}
        </div>
      )}
    </div>
  );
}
