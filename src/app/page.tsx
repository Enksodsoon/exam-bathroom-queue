"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, createSession } from "@/lib/client/api";
import {
  removeRecentSession,
  saveControllerKey,
  useRecentSessions,
} from "@/lib/client/storage";
import { useAppPreferences } from "@/components/AppPreferencesProvider";
import { AuthorFooter } from "@/components/AuthorFooter";
import { HomeQrScanner } from "@/components/HomeQrScanner";
import { resolveExamJoinPath } from "@/lib/client/joinLink";
import { ArrowRightIcon, CloseIcon, PlusIcon, QrIcon } from "@/components/Icons";
import { ThemeLangToggle } from "@/components/ThemeLangToggle";

export default function HomePage() {
  const router = useRouter();
  const { t } = useAppPreferences();
  const recentSessions = useRecentSessions();
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
    const destination = resolveExamJoinPath(joinInput, window.location.origin);
    if (!destination) {
      setJoinError(t.pasteLinkError);
      return;
    }
    setJoinError(null);
    router.push(destination);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center overflow-x-hidden px-5 py-10 sm:px-8">
      <div className="mb-4 flex justify-end">
        <ThemeLangToggle />
      </div>
      <header className="mb-7 flex flex-col items-center text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-medium tracking-wide text-slate-600 shadow-2xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>{t.appName}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-100">
          {t.bathroomQueue}
        </h1>
      </header>

      {recentSessions.length > 0 && (
        <section
          data-testid="resume-sessions-card"
          aria-label={t.resumeSessionTitle}
          className="mb-5 rounded-3xl border border-emerald-200/90 bg-emerald-50/70 p-4 shadow-2xs sm:p-5 dark:border-emerald-800/70 dark:bg-emerald-950/30"
        >
          <p className="mb-2.5 text-xs font-semibold tracking-wide text-emerald-900 uppercase dark:text-emerald-200">
            {t.resumeSessionTitle}
          </p>
          <div className="space-y-2">
            {recentSessions.map((item) => (
              <div
                key={`${item.sessionId}-${item.role}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200/80 bg-white px-3.5 py-2.5 dark:border-emerald-800/60 dark:bg-slate-900"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      item.role === "controller"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200"
                        : "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200"
                    }`}
                  >
                    {item.role === "controller"
                      ? t.controller
                      : item.label
                        ? `${t.staff} · ${item.label}`
                        : t.staff}
                  </span>
                  <span className="truncate font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {item.sessionId}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/s/${encodeURIComponent(item.sessionId)}`}
                    data-testid={`resume-session-${item.sessionId}`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <span>{t.resumeBtn}</span>
                    <ArrowRightIcon className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeRecentSession(item.sessionId)}
                    aria-label={t.dismissRecentAria}
                    title={t.dismissRecentAria}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* New Exam Session (Controller) */}
        <section
          aria-label="Create Exam Session"
          className="flex min-w-0 flex-col justify-between gap-4 rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs transition hover:border-slate-300/90 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
              <PlusIcon className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              {t.controller}
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {t.newExam}
            </h2>
          </div>

          <div className="space-y-3">
            {createError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
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
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <span>{creating ? t.starting : t.create}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* Join Existing Session (Staff) */}
        <section
          aria-label="Join Existing Session"
          className="flex min-w-0 flex-col justify-between gap-4 rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs transition hover:border-slate-300/90 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
              <QrIcon className="h-6 w-6" />
            </div>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
              {t.staff}
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {t.joinSession}
            </h2>
          </div>

          <HomeQrScanner onJoin={(path) => router.push(path)} />

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
              placeholder={t.staffLinkPlaceholder}
              className="min-h-[46px] w-full rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-400 dark:focus:bg-slate-800"
            />

            {joinError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
              >
                {joinError}
              </div>
            )}

            <button
              type="submit"
              aria-label="Join Session"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <span>{t.joinButton}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
        </section>
      </div>
      <AuthorFooter />
    </main>
  );
}
