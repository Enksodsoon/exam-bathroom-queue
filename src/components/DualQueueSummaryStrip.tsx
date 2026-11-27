"use client";

import type { NextBySex, QueueEntry, Sex } from "@/lib/domain/types";
import { useAppPreferences } from "./AppPreferencesProvider";
import { FemaleIcon, MaleIcon } from "./Icons";

interface DualQueueSummaryStripProps {
  entries: QueueEntry[];
  nextBySex: NextBySex;
}

export function DualQueueSummaryStrip({
  entries,
  nextBySex,
}: DualQueueSummaryStripProps) {
  const { t } = useAppPreferences();

  const renderSlot = (sex: Sex) => {
    const scoped = entries.filter((e) => e.sex === sex);
    const inBathroom = scoped.find((e) => e.status === "in_bathroom") ?? null;
    const queued = scoped.filter((e) => e.status === "queued");
    const nextEntry =
      (nextBySex[sex]
        ? queued.find((e) => e.id === nextBySex[sex])
        : null) ?? queued[0] ?? null;
    const isMale = sex === "M";

    return (
      <div
        key={sex}
        data-testid={`dual-summary-${sex}`}
        className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                isMale
                  ? "bg-sky-500/12 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                  : "bg-rose-500/12 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
              }`}
            >
              {isMale ? (
                <MaleIcon className="h-3.5 w-3.5" />
              ) : (
                <FemaleIcon className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              {isMale ? t.male : t.female}
            </span>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-300">
            {queued.length} {t.waitingShort}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {inBathroom ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-mono font-bold text-amber-950 dark:bg-amber-950/70 dark:text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />#
              {inBathroom.studentNumber}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              {t.vacant}
            </span>
          )}

          {nextEntry && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
              {t.nextUp}: #{nextEntry.studentNumber}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="dual-queue-summary"
      aria-label="Male and Female Live Summary"
      className="grid grid-cols-2 gap-2.5"
    >
      {renderSlot("M")}
      {renderSlot("F")}
    </div>
  );
}
