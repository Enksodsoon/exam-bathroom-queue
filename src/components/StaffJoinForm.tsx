"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SessionSnapshot } from "@/lib/domain/types";
import { ApiClientError, joinSession } from "@/lib/client/api";
import {
  saveStaffIdentity,
  type StoredStaffIdentity,
} from "@/lib/client/storage";
import { useAppPreferences } from "./AppPreferencesProvider";
import { ArrowRightIcon, UserBadgeIcon } from "./Icons";
import { ThemeLangToggle } from "./ThemeLangToggle";

interface StaffJoinFormProps {
  sessionId: string;
  initialLabel?: string;
  inviteCode?: string | null;
  onJoined: (
    identity: StoredStaffIdentity,
    snapshot: SessionSnapshot,
    persisted: boolean,
  ) => void;
}

const MAX_LABEL_LEN = 40;

export function StaffJoinForm({
  sessionId,
  initialLabel = "",
  inviteCode = null,
  onJoined,
}: StaffJoinFormProps) {
  const { t } = useAppPreferences();
  const [label, setLabel] = useState(initialLabel);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      setError(t.enterNameError);
      return;
    }
    if (trimmed.length > MAX_LABEL_LEN) {
      setError(`Max ${MAX_LABEL_LEN} characters.`);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await joinSession(sessionId, trimmed, inviteCode);
      const identity: StoredStaffIdentity = {
        staffId: res.staffId,
        label: res.label,
        ...(res.staffToken ? { staffToken: res.staffToken } : {}),
      };
      const persisted = saveStaffIdentity(sessionId, identity);
      onJoined(identity, res.snapshot, persisted);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("Unable to join session.");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200/90 bg-white p-7 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
          <UserBadgeIcon className="h-6 w-6" />
        </div>
        <div className="flex items-center gap-2">
          <span className="max-w-[120px] truncate rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {sessionId}
          </span>
          <ThemeLangToggle />
        </div>
      </div>

      <div className="mt-5 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {t.staffCheckIn}
        </h1>
      </div>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="mt-6 space-y-3"
        noValidate
      >
        <label htmlFor="staff-label-input" className="sr-only">
          Your Name or Label
        </label>
        <input
          id="staff-label-input"
          name="label"
          type="text"
          autoComplete="name"
          maxLength={MAX_LABEL_LEN + 5}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (error) {
              setError(null);
            }
          }}
          placeholder={t.yourNamePlaceholder}
          className="min-h-[48px] w-full rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-400 dark:focus:bg-slate-800"
        />

        {error && (
          <div
            role="alert"
            className="min-w-0 max-w-full rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium break-words [overflow-wrap:anywhere] text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          aria-label="Join Session"
          disabled={submitting}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          <span>{submitting ? t.joining : t.joinButton}</span>
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
