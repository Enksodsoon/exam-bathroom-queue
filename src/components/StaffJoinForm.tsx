"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SessionSnapshot } from "@/lib/domain/types";
import { ApiClientError, joinSession } from "@/lib/client/api";
import {
  saveStaffIdentity,
  type StoredStaffIdentity,
} from "@/lib/client/storage";

interface StaffJoinFormProps {
  sessionId: string;
  initialLabel?: string;
  onJoined: (identity: StoredStaffIdentity, snapshot: SessionSnapshot) => void;
}

const MAX_LABEL_LEN = 40;

export function StaffJoinForm({
  sessionId,
  initialLabel = "",
  onJoined,
}: StaffJoinFormProps) {
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
      setError("Please enter your name or label to join.");
      return;
    }
    if (trimmed.length > MAX_LABEL_LEN) {
      setError(`Name/label must be ${MAX_LABEL_LEN} characters or fewer.`);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await joinSession(sessionId, trimmed);
      const identity: StoredStaffIdentity = {
        staffId: res.staffId,
        label: res.label,
      };
      saveStaffIdentity(sessionId, identity);
      onJoined(identity, res.snapshot);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("Unable to join session. Please try again.");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <div className="min-w-0 space-y-1">
        <p className="max-w-full text-xs font-bold tracking-wide break-all text-slate-500 uppercase">
          Session {sessionId}
        </p>
        <h1 className="text-xl font-bold text-slate-900">
          Join as Roaming Staff
        </h1>
        <p className="text-sm text-slate-600">
          Enter your name or room/hall label. No account or password is
          required.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="mt-5 space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <label
            htmlFor="staff-label-input"
            className="block text-sm font-medium text-slate-800"
          >
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
            placeholder="e.g. Proctor A / Hall 2"
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
          />
          <p className="text-xs text-slate-500">
            Maximum {MAX_LABEL_LEN} characters.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="min-w-0 max-w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm break-words [overflow-wrap:anywhere] text-rose-800"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-base font-semibold text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-500 focus:outline-none disabled:opacity-50"
        >
          {submitting ? "Joining..." : "Join Session"}
        </button>
      </form>
    </section>
  );
}
