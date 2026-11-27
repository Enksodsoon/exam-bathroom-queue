"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAppPreferences } from "@/components/AppPreferencesProvider";
import { AuthorFooter } from "@/components/AuthorFooter";
import { ThemeLangToggle } from "@/components/ThemeLangToggle";
import { useRecentSessions } from "@/lib/client/storage";
import { GUIDE_CONTENT, type GuideRole } from "@/lib/i18n/guideContent";

export default function GuidePage() {
  const { locale, t } = useAppPreferences();
  const recentSessions = useRecentSessions();
  const latestSession = recentSessions[0] ?? null;
  const bundle = GUIDE_CONTENT[locale];
  const [roleFilter, setRoleFilter] = useState<GuideRole>("all");

  const visibleSections =
    roleFilter === "all"
      ? bundle.sections
      : bundle.sections.filter(
          (s) => s.role === "all" || s.role === roleFilter,
        );

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={latestSession ? `/s/${encodeURIComponent(latestSession.sessionId)}` : "/"}
          data-testid="guide-back-link"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true">←</span>
          <span>{latestSession ? t.backToSession : t.backToApp}</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[44px] items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {bundle.printBtn}
          </button>
          <ThemeLangToggle />
        </div>
      </div>

      <header className="mb-8 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>{t.appName}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
          {bundle.heroTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {bundle.heroSubtitle}
        </p>

        {/* Role filter */}
        <div className="mt-5 flex flex-wrap items-center gap-2 print:hidden">
          {(["all", "controller", "staff"] as GuideRole[]).map((role) => {
            const active = roleFilter === role;
            return (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={`inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
                  active
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {role === "all" ? bundle.allRoles : bundle.roleLabels[role]}
              </button>
            );
          })}
        </div>

        {/* Table of contents */}
        <nav
          aria-label="Manual sections"
          className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 print:hidden"
        >
          {visibleSections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="inline-flex min-h-[36px] items-center rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {section.title}
            </a>
          ))}
        </nav>
      </header>

      <div className="space-y-8">
        {visibleSections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            data-testid={`guide-section-${section.id}`}
            className="scroll-mt-6 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-7 dark:border-slate-800 dark:bg-slate-900 print:break-inside-avoid"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 sm:text-xl dark:text-slate-100">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {section.subtitle}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  section.role === "controller"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : section.role === "staff"
                      ? "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {bundle.roleLabels[section.role]}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 lg:col-span-7 dark:border-slate-700 dark:bg-slate-950">
                <Image
                  src={section.image}
                  alt={section.title}
                  width={1120}
                  height={860}
                  className="h-auto w-full object-contain"
                />
              </div>

              <div className="space-y-3 lg:col-span-5">
                {section.steps.map((step) => (
                  <div
                    key={step.num}
                    className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
                  >
                    <span
                      style={{ backgroundColor: step.color }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-xs"
                    >
                      {step.num}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {step.action}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                ))}

                {section.tip && (
                  <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-semibold">{bundle.tipLabel}: </span>
                    {section.tip}
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      <AuthorFooter />
    </main>
  );
}
