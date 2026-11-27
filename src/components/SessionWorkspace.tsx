"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  clearControllerKey,
  clearStaffIdentity,
  removeRecentSession,
  saveControllerKey,
  useStoredControllerKey,
  useStoredStaffIdentity,
  type StoredStaffIdentity,
} from "@/lib/client/storage";
import { useNextStudentAlert } from "@/lib/client/useNextStudentAlert";
import { useSessionSync } from "@/lib/client/useSessionSync";
import { useAppPreferences } from "./AppPreferencesProvider";
import { AuthorFooter } from "./AuthorFooter";
import { ControllerDashboard } from "./ControllerDashboard";
import { StaffJoinForm } from "./StaffJoinForm";
import { StaffView } from "./StaffView";

interface SessionWorkspaceProps {
  sessionId: string;
  initialKey: string | null;
  initialInviteCode?: string | null;
  initialNotFound?: boolean;
  initialKeyRejected?: boolean;
}

export function SessionWorkspace({
  sessionId,
  initialKey,
  initialInviteCode = null,
  initialNotFound = false,
  initialKeyRejected = false,
}: SessionWorkspaceProps) {
  const { t } = useAppPreferences();
  const storedControllerKey = useStoredControllerKey(sessionId);
  const storedStaffIdentity = useStoredStaffIdentity(sessionId);

  const trimmedInitialKey =
    !initialNotFound &&
    !initialKeyRejected &&
    initialKey &&
    initialKey.trim().length > 0
      ? initialKey.trim()
      : null;

  const [inMemoryStaffIdentity, setInMemoryStaffIdentity] =
    useState<StoredStaffIdentity | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const controllerKey = initialKeyRejected
    ? null
    : (storedControllerKey ?? trimmedInitialKey);
  const staffIdentity = storedStaffIdentity ?? inMemoryStaffIdentity;

  useEffect(() => {
    if (initialNotFound) {
      return;
    }
    const cleanUrl = `/s/${encodeURIComponent(sessionId)}`;
    if (initialKeyRejected) {
      clearControllerKey(sessionId);
      if (
        typeof window !== "undefined" &&
        (window.location.pathname !== cleanUrl || window.location.search !== "")
      ) {
        window.history.replaceState(null, "", cleanUrl);
      }
      return;
    }
    if (!trimmedInitialKey) {
      return;
    }
    const persisted = saveControllerKey(sessionId, trimmedInitialKey);
    if (!persisted) {
      queueMicrotask(() => {
        setStorageWarning(
          "Reloading may end controller access.",
        );
      });
    }
    if (
      persisted &&
      typeof window !== "undefined" &&
      (window.location.pathname !== cleanUrl || window.location.search !== "")
    ) {
      window.history.replaceState(null, "", cleanUrl);
    }
  }, [sessionId, trimmedInitialKey, initialNotFound, initialKeyRejected]);

  const isController = !initialNotFound && Boolean(controllerKey);
  const canSync = !initialNotFound && (isController || Boolean(staffIdentity));
  const alertsEnabled = canSync;

  const alert = useNextStudentAlert({ enabled: alertsEnabled, sessionId });
  const sync = useSessionSync(sessionId, {
    enabled: canSync,
    initialNotFound,
    auth: {
      controllerKey,
      staffToken: staffIdentity?.staffToken ?? null,
    },
    onSnapshot: alert.handleSnapshot,
  });

  useEffect(() => {
    if (initialNotFound || sync.notFound) {
      removeRecentSession(sessionId);
    }
  }, [initialNotFound, sync.notFound, sessionId]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8">
      {storageWarning && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900"
        >
          {storageWarning}
        </div>
      )}

      {initialNotFound || sync.notFound ? (
        <section className="mx-auto max-w-md rounded-3xl border border-slate-200/90 bg-white p-7 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.sessionNotFoundTitle}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t.sessionNotFoundBody}</p>
          <div className="mt-5">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {t.backHome}
            </Link>
          </div>
        </section>
      ) : isController && controllerKey ? (
        <ControllerDashboard
          sessionId={sessionId}
          controllerKey={controllerKey}
          snapshot={sync.snapshot}
          syncError={sync.syncError}
          syncStale={sync.syncStale}
          lastSyncedAtMs={sync.lastSyncedAtMs}
          lastSyncedAgeSeconds={sync.lastSyncedAgeSeconds}
          alert={alert}
          onMutationSnapshot={sync.applyMutationSnapshot}
        />
      ) : staffIdentity ? (
        <StaffView
          sessionId={sessionId}
          staffIdentity={staffIdentity}
          snapshot={sync.snapshot}
          syncError={sync.syncError}
          syncStale={sync.syncStale}
          lastSyncedAtMs={sync.lastSyncedAtMs}
          lastSyncedAgeSeconds={sync.lastSyncedAgeSeconds}
          alert={alert}
          onMutationSnapshot={sync.applyMutationSnapshot}
          onChangeName={() => {
            clearStaffIdentity(sessionId);
            setInMemoryStaffIdentity(null);
          }}
        />
      ) : (
        <StaffJoinForm
          sessionId={sessionId}
          inviteCode={initialInviteCode}
          onJoined={(identity, snapshot, persisted) => {
            setInMemoryStaffIdentity(identity);
            if (!persisted) {
              setStorageWarning(
                "Reloading requires joining again.",
              );
            }
            sync.applyMutationSnapshot(snapshot);
          }}
        />
      )}
      <AuthorFooter />
    </main>
  );
}
