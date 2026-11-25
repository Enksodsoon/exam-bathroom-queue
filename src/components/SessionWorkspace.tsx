"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  clearControllerKey,
  clearStaffIdentity,
  saveControllerKey,
  useStoredControllerKey,
  useStoredStaffIdentity,
} from "@/lib/client/storage";
import { useNextStudentAlert } from "@/lib/client/useNextStudentAlert";
import { useSessionSync } from "@/lib/client/useSessionSync";
import { ControllerDashboard } from "./ControllerDashboard";
import { StaffJoinForm } from "./StaffJoinForm";
import { StaffView } from "./StaffView";

interface SessionWorkspaceProps {
  sessionId: string;
  initialKey: string | null;
  initialNotFound?: boolean;
  initialKeyRejected?: boolean;
}

export function SessionWorkspace({
  sessionId,
  initialKey,
  initialNotFound = false,
  initialKeyRejected = false,
}: SessionWorkspaceProps) {
  const storedControllerKey = useStoredControllerKey(sessionId);
  const staffIdentity = useStoredStaffIdentity(sessionId);

  const trimmedInitialKey =
    !initialNotFound &&
    !initialKeyRejected &&
    initialKey &&
    initialKey.trim().length > 0
      ? initialKey.trim()
      : null;
  const controllerKey = initialKeyRejected
    ? null
    : (storedControllerKey ?? trimmedInitialKey);

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
    saveControllerKey(sessionId, trimmedInitialKey);
    if (
      typeof window !== "undefined" &&
      (window.location.pathname !== cleanUrl || window.location.search !== "")
    ) {
      window.history.replaceState(null, "", cleanUrl);
    }
  }, [sessionId, trimmedInitialKey, initialNotFound, initialKeyRejected]);

  const isController = !initialNotFound && Boolean(controllerKey);
  const alertsEnabled =
    !initialNotFound && (isController || Boolean(staffIdentity));
  const alert = useNextStudentAlert({ enabled: alertsEnabled });
  const sync = useSessionSync(sessionId, {
    enabled: !initialNotFound,
    initialNotFound,
    onSnapshot: alert.handleSnapshot,
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8">
      {initialNotFound || sync.notFound ? (
        <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-xs">
          <h1 className="text-xl font-bold text-slate-900">
            Session Not Found
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            The exam session{" "}
            <span className="font-mono font-semibold break-all text-slate-900">
              {sessionId}
            </span>{" "}
            does not exist or has expired.
          </p>
          <div className="mt-5">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Back to Home
            </Link>
          </div>
        </section>
      ) : isController && controllerKey ? (
        <ControllerDashboard
          sessionId={sessionId}
          controllerKey={controllerKey}
          snapshot={sync.snapshot}
          syncError={sync.syncError}
          lastSyncedAtMs={sync.lastSyncedAtMs}
          alert={alert}
          onMutationSnapshot={sync.applyMutationSnapshot}
        />
      ) : staffIdentity ? (
        <StaffView
          sessionId={sessionId}
          staffIdentity={staffIdentity}
          snapshot={sync.snapshot}
          syncError={sync.syncError}
          lastSyncedAtMs={sync.lastSyncedAtMs}
          alert={alert}
          onMutationSnapshot={sync.applyMutationSnapshot}
          onChangeName={() => clearStaffIdentity(sessionId)}
        />
      ) : (
        <div className="space-y-4">
          <div className="text-center">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              &larr; Back to Home
            </Link>
          </div>
          <StaffJoinForm
            sessionId={sessionId}
            onJoined={(_identity, nextSnapshot) => {
              sync.applyMutationSnapshot(nextSnapshot);
            }}
          />
        </div>
      )}
    </main>
  );
}
