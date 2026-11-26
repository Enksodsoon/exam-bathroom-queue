"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, createSession } from "@/lib/client/api";
import { saveControllerKey } from "@/lib/client/storage";
import { ArrowRightIcon, PlusIcon, QrIcon } from "@/components/Icons";

function extractStaffDestination(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  // Never navigate to the caller's origin or forward a controller credential.
  // Accept the legacy bare session ID, or retain only the staff invite from a link.
  if (/^[\w-]+$/.test(trimmed)) return `/s/${encodeURIComponent(trimmed)}`;
  try {
    const url = new URL(trimmed.startsWith("s/") ? `/${trimmed}` : trimmed, "https://examq.invalid");
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const match = url.pathname.match(/^\/s\/([\w-]+)\/?$/);
    if (!match) return "";
    const invite = url.searchParams.get("invite")?.trim();
    const path = `/s/${encodeURIComponent(match[1])}`;
    return invite ? `${path}?${new URLSearchParams({ invite })}` : path;
  } catch {
    return "";
  }
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
          : "Unable to start session.",
      );
      setCreating(false);
    }
  };

  const handleJoinSession = (e: FormEvent) => {
    e.preventDefault();
    const destination = extractStaffDestination(joinInput);
    if (!destination) {
      setJoinError("Enter a session code or link.");
      return;
    }
    setJoinError(null);
    router.push(destination);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center overflow-x-hidden px-5 py-10 sm:px-8">
      <header className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-medium tracking-wide text-slate-600 shadow-2xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>ExamQ</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Bathroom Queue
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* New Exam Session (Controller) */}
        <section
          aria-label="Create Exam Session"
          className="flex min-w-0 flex-col justify-between gap-6 rounded-3xl border border-slate-200/90 bg-white p-7 shadow-xs transition hover:border-slate-300/90"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700">
              <PlusIcon className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Controller
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              New Exam
            </h2>
            <p className="text-sm text-slate-500">
              1-tap session, timer &amp; QR
            </p>
          </div>

          <div className="space-y-3">
            {createError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
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
              aria-label="Create Exam Session"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-50"
            >
              <span>{creating ? "Starting..." : "Create Exam Session"}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* Join Existing Session (Staff) */}
        <section
          aria-label="Join Existing Session"
          className="flex min-w-0 flex-col justify-between gap-6 rounded-3xl border border-slate-200/90 bg-white p-7 shadow-xs transition hover:border-slate-300/90"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700">
              <QrIcon className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
              Staff
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Join Session
            </h2>
            <p className="text-sm text-slate-500">
              Open your proctor’s QR link, or paste it here.
            </p>
          </div>

          <form
            onSubmit={handleJoinSession}
            className="space-y-3"
            noValidate
          >
            <label htmlFor="join-session-input" className="sr-only">
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
              placeholder="Paste staff invitation link"
              className="min-h-[46px] w-full rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />

            {joinError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                {joinError}
              </div>
            )}

            <button
              type="submit"
              aria-label="Join Session"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none"
            >
              <span>Join Session</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
