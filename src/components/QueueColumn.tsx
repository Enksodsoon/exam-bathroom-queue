"use client";

import { useState } from "react";
import type { EntryAction, QueueEntry, Sex } from "@/lib/domain/types";
import { formatTimeOnly } from "@/lib/client/format";
import { useAppPreferences } from "./AppPreferencesProvider";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckReturnIcon,
  DoorEnterIcon,
  FemaleIcon,
  MaleIcon,
  ShieldIcon,
  TrashIcon,
} from "./Icons";

interface QueueColumnProps {
  sex: Sex;
  entries: QueueEntry[];
  mode: "controller" | "staff";
  nextEntryId: string | null;
  busyEntryId?: string | null;
  busyEntryIds?: ReadonlySet<string>;
  onEntryAction?: (entryId: string, action: EntryAction) => void;
  onReorder?: (entryId: string, direction: "up" | "down") => void;
}

export function QueueColumn({
  sex,
  entries,
  mode,
  nextEntryId,
  busyEntryId = null,
  busyEntryIds,
  onEntryAction,
  onReorder,
}: QueueColumnProps) {
  const { t } = useAppPreferences();
  const [historyOpen, setHistoryOpen] = useState(false);

  const isEntryBusy = (entryId: string): boolean =>
    Boolean(busyEntryIds?.has(entryId)) || busyEntryId === entryId;
  const sexLabel = sex === "M" ? t.male : t.female;
  const regionLabel = sex === "M" ? "Male Queue" : "Female Queue";

  const scoped = entries.filter((entry) => entry.sex === sex);
  const inBathroom =
    scoped.find((entry) => entry.status === "in_bathroom") ?? null;
  const queued = scoped.filter((entry) => entry.status === "queued");
  const history = scoped
    .filter(
      (entry) => entry.status === "returned" || entry.status === "removed",
    )
    .slice()
    .reverse();

  return (
    <section
      aria-label={regionLabel}
      data-testid={`queue-column-${sex}`}
      data-sex={sex}
      className="flex min-w-0 flex-col gap-4 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Column Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
              sex === "M"
                ? "bg-sky-500/12 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300"
                : "bg-rose-500/12 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300"
            }`}
          >
            {sex === "M" ? (
              <MaleIcon className="h-4 w-4" />
            ) : (
              <FemaleIcon className="h-4 w-4" />
            )}
          </span>
          <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {sexLabel}
          </h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-300">
          {queued.length}
        </span>
      </div>

      {/* Live Occupancy Pill */}
      <div
        data-testid={`occupancy-${sex}`}
        data-occupancy={inBathroom ? "occupied" : "vacant"}
        aria-label={`${sexLabel} Bathroom Occupancy`}
        className={`rounded-2xl border p-3.5 transition ${
          inBathroom
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/40"
            : "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/30"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                inBathroom ? "bg-amber-600 dark:bg-amber-400" : "bg-emerald-700 dark:bg-emerald-400"
              }`}
            />
            {inBathroom ? (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-base font-bold break-words [overflow-wrap:anywhere] text-slate-900 tabular-nums dark:text-slate-100">
                    #{inBathroom.studentNumber}
                  </span>
                  {inBathroom.override && (
                    <span
                      title={t.overrideLabel}
                      className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-900 dark:bg-purple-950/70 dark:text-purple-200"
                    >
                      <ShieldIcon className="h-3 w-3" />
                      <span>{t.overrideLabel}</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] break-words [overflow-wrap:anywhere] text-slate-600 dark:text-slate-400">
                  {inBathroom.submittedBy}
                  {inBathroom.enteredAt !== null
                    ? ` · ${formatTimeOnly(inBathroom.enteredAt)}`
                    : ""}
                </p>
              </div>
            ) : (
              <span className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                {t.vacant}
              </span>
            )}
          </div>

          {inBathroom && onEntryAction ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isEntryBusy(inBathroom.id)}
                onClick={() => onEntryAction(inBathroom.id, "return")}
                aria-label={`Mark Returned #${inBathroom.studentNumber}`}
                title={`Mark Returned #${inBathroom.studentNumber}`}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-emerald-700 px-3.5 text-xs font-semibold text-white transition hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
              >
                <CheckReturnIcon className="h-4 w-4" />
                <span>{t.markReturned}</span>
              </button>
            </div>
          ) : inBathroom ? (
            <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-amber-950 dark:bg-amber-900/70 dark:text-amber-100">
              {t.inBathroom}
            </span>
          ) : null}
        </div>
      </div>

      {/* Waiting FIFO Queue */}
      {queued.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-400">
          {t.emptyQueue}
        </div>
      ) : (
        <ol className="space-y-2">
          {queued.map((entry, idx) => {
            const isNext = nextEntryId === entry.id || idx === 0;
            const isBusy = isEntryBusy(entry.id);

            return (
              <li
                key={entry.id}
                data-entry-id={entry.id}
                data-student-number={entry.studentNumber}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 transition ${
                  isNext
                    ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-800/70 dark:bg-emerald-950/40"
                    : "border-slate-200/80 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium text-slate-600 tabular-nums dark:text-slate-400">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 max-w-full font-mono text-base font-bold break-words [overflow-wrap:anywhere] text-slate-900 tabular-nums dark:text-slate-100">
                      #{entry.studentNumber}
                    </span>
                    {isNext && (
                      <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
                        {t.nextUp}
                      </span>
                    )}
                    {entry.override && (
                      <span
                        title={t.overrideLabel}
                        className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-900 dark:bg-purple-950/70 dark:text-purple-200"
                      >
                        <ShieldIcon className="h-3 w-3" />
                        <span>{t.overrideLabel}</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 min-w-0 max-w-full text-[11px] break-words [overflow-wrap:anywhere] text-slate-600 dark:text-slate-400">
                    {entry.submittedBy} · {formatTimeOnly(entry.createdAt)}
                  </p>
                </div>

                {(onEntryAction || (mode === "controller" && onReorder)) && (
                  <div className="flex items-center gap-1">
                    {onEntryAction && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEntryAction(entry.id, "enter")}
                        aria-label={`Enter Bathroom #${entry.studentNumber}`}
                        title={`Enter Bathroom #${entry.studentNumber}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-500 focus:outline-none disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                      >
                        <DoorEnterIcon className="h-4 w-4" />
                      </button>
                    )}
                    {mode === "controller" && onReorder && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy || idx === 0}
                          onClick={() => onReorder(entry.id, "up")}
                          aria-label={`Move Up #${entry.studentNumber}`}
                          title={`Move Up #${entry.studentNumber}`}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <ArrowUpIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || idx === queued.length - 1}
                          onClick={() => onReorder(entry.id, "down")}
                          aria-label={`Move Down #${entry.studentNumber}`}
                          title={`Move Down #${entry.studentNumber}`}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <ArrowDownIcon className="h-4 w-4" />
                        </button>
                        {onEntryAction && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onEntryAction(entry.id, "remove")}
                            aria-label={`Remove #${entry.studentNumber}`}
                            title={`Remove #${entry.studentNumber}`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 focus:ring-2 focus:ring-rose-400 focus:outline-none disabled:opacity-40 dark:border-rose-800 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/50"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Collapsible History Pill */}
      {history.length > 0 && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setHistoryOpen((prev) => !prev)}
            aria-expanded={historyOpen}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <span>History ({history.length})</span>
            <span>{historyOpen ? "−" : "+"}</span>
          </button>
          {historyOpen && (
            <div className="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex min-w-0 max-w-full items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-1.5 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                >
                  <span className="min-w-0 max-w-full font-mono font-semibold break-words [overflow-wrap:anywhere] text-slate-900 dark:text-slate-100">
                    #{entry.studentNumber}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      entry.status === "returned"
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200"
                        : "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {entry.status === "returned" ? t.markReturned : t.removeAria}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
