"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, createSession } from "@/lib/client/api";
import { saveControllerKey } from "@/lib/client/storage";

function extractSessionId(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "";
  }

  try {
    if (trimmed.includes("://")) {
      const url = new URL(trimmed);
      const match = url.pathname.match(/\/s\/([^/]+)/);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  } catch {
    // Fall through to path parsing
  }

  const withoutQuery = trimmed.split("?")[0]?.split("#")[0] ?? "";
  const pathMatch = withoutQuery.match(/(?:^|\/)s\/([^/]+)\/?$/);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]);
    } catch {
      return pathMatch[1];
    }
  }

  return withoutQuery.replace(/^\/+|\/+$/g, "");
}

export default function HomePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleCreateSession = async () => {
    if (creatingRef.current) {
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createSession();
      saveControllerKey(res.sessionId, res.controllerKey);
      router.push(res.controllerUrl);
    } catch (err) {
      creatingRef.current = false;
      setCreateError(
        err instanceof ApiClientError
          ? err.message
          : "Failed to create exam session. Please try again.",
      );
      setCreating(false);
    }
  };

  const handleJoinSession = (e: FormEvent) => {
    e.preventDefault();
    const extracted = extractSessionId(joinInput);
    if (!extracted) {
      setJoinError("Please enter a session ID or join link.");
      return;
    }
    setJoinError(null);
    router.push(`/s/${encodeURIComponent(extracted)}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center overflow-x-hidden px-4 py-8 sm:px-6">
      <div className="space-y-2 text-center">
        <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">
          Live Exam Administration
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Exam Bathroom Queue
        </h1>
        <p className="mx-auto max-w-xl text-sm text-slate-600 sm:text-base">
          Coordinate Male and Female bathroom queues in real time across
          controller and roaming staff devices with QR joining and automatic
          exam time-window enforcement.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Create Exam Session */}
        <section
          aria-label="Create Exam Session"
          className="flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Queue Controller
            </h2>
            <p className="text-sm text-slate-600">
              Start a new exam session to configure exam start &amp; duration,
              share a staff QR link, and manage bathroom entry &amp; return.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {createError && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
              >
                {createError}
              </div>
            )}

            <button
              type="button"
              disabled={creating}
              onClick={() => {
                void handleCreateSession();
              }}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-500 focus:outline-none disabled:opacity-50"
            >
              {creating ? "Creating Session..." : "Create Exam Session"}
            </button>
          </div>
        </section>

        {/* Join Existing Session */}
        <section
          aria-label="Join Existing Session"
          className="flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Join Existing Session
            </h2>
            <p className="text-sm text-slate-600">
              Roaming staff can enter a session ID or paste a session link to
              open the live queue without an account.
            </p>
          </div>

          <form
            onSubmit={handleJoinSession}
            className="mt-6 space-y-3"
            noValidate
          >
            <div className="space-y-1.5">
              <label
                htmlFor="join-session-input"
                className="block text-sm font-medium text-slate-800"
              >
                Session ID or Link
              </label>
              <input
                id="join-session-input"
                name="sessionId"
                type="text"
                value={joinInput}
                onChange={(e) => {
                  setJoinInput(e.target.value);
                  if (joinError) {
                    setJoinError(null);
                  }
                }}
                placeholder="e.g. abc123 or /s/abc123"
                className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
              />
            </div>

            {joinError && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
              >
                {joinError}
              </div>
            )}

            <button
              type="submit"
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-500 focus:outline-none"
            >
              Join Session
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
