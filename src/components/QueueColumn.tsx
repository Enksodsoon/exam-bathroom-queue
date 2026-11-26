"use client";

import { useState } from "react";
import type { EntryAction, QueueEntry, Sex } from "@/lib/domain/types";
import { formatTimeOnly } from "@/lib/client/format";
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
  const [historyOpen, setHistoryOpen] = useState(false);

  const isEntryBusy = (entryId: string): boolean =>
    Boolean(busyEntryIds?.has(entryId)) || busyEntryId === entryId;
  const sexLabel = sex === "M" ? "Male" : "Female";
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
      className="flex min-w-0 flex-col gap-4 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs"
    >
      {/* Column Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
              sex === "M"
                ? "bg-sky-500/12 text-sky-700"
                : "bg-rose-500/12 text-rose-700"
            }`}
          >
            {sex === "M" ? (
              <MaleIcon className="h-4 w-4" />
            ) : (
              <FemaleIcon className="h-4 w-4" />
            )}
          </span>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            {sexLabel}
          </h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700 tabular-nums">
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
            ? "border-amber-200 bg-amber-50/70"
            : "border-emerald-200/80 bg-emerald-50/60"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                inBathroom ? "bg-amber-500" : "bg-emerald-500"
              }`}
            />
            {inBathroom ? (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-base font-bold break-words [overflow-wrap:anywhere] text-slate-900 tabular-nums">
                    #{inBathroom.studentNumber}
                  </span>
                  {inBathroom.override && (
                    <span
                      title="Controller Override"
                      className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-800"
                    >
                      <ShieldIcon className="h-3 w-3" />
                      <span>Override</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] break-words [overflow-wrap:anywhere] text-slate-500">
                  {inBathroom.submittedBy}
                  {inBathroom.enteredAt !== null
                    ? ` · ${formatTimeOnly(inBathroom.enteredAt)}`
                    : ""}
                </p>
              </div>
            ) : (
              <span className="text-sm font-medium text-emerald-800">
                Vacant
              </span>
            )}
          </div>

          {inBathroom && mode === "controller" && onEntryAction ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isEntryBusy(inBathroom.id)}
                onClick={() => onEntryAction(inBathroom.id, "return")}
                aria-label="Mark Returned"
                title="Mark Returned"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckReturnIcon className="h-4 w-4" />
                <span>Returned</span>
              </button>
              <button
                type="button"
                disabled={isEntryBusy(inBathroom.id)}
                onClick={() => onEntryAction(inBathroom.id, "remove")}
                aria-label="Remove"
                title="Remove"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                inBathroom
                  ? "bg-amber-200/70 text-amber-950"
                  : "bg-emerald-200/70 text-emerald-950"
              }`}
            >
              {inBathroom ? "Occupied" : "Open"}
            </span>
          )}
        </div>
      </div>

      {/* Waiting FIFO Queue */}
      {queued.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs font-medium text-slate-400">
          Empty queue
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
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-slate-200/80 bg-slate-50/60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium text-slate-400 tabular-nums">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 max-w-full font-mono text-base font-bold break-words [overflow-wrap:anywhere] text-slate-900 tabular-nums">
                      #{entry.studentNumber}
                    </span>
                    {isNext && (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
                        NEXT
                      </span>
                    )}
                    {entry.override && (
                      <span
                        title="Controller Override"
                        className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-800"
                      >
                        <ShieldIcon className="h-3 w-3" />
                        <span>Override</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 min-w-0 max-w-full text-[11px] break-words [overflow-wrap:anywhere] text-slate-500">
                    {entry.submittedBy} · {formatTimeOnly(entry.createdAt)}
                  </p>
                </div>

                {mode === "controller" && onEntryAction && onReorder && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onEntryAction(entry.id, "enter")}
                      aria-label="Enter Bathroom"
                      title="Enter Bathroom"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-40"
                    >
                      <DoorEnterIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || idx === 0}
                      onClick={() => onReorder(entry.id, "up")}
                      aria-label="Move Up"
                      title="Move Up"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || idx === queued.length - 1}
                      onClick={() => onReorder(entry.id, "down")}
                      aria-label="Move Down"
                      title="Move Down"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowDownIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onEntryAction(entry.id, "remove")}
                      aria-label="Remove"
                      title="Remove"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-40"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Collapsible History Pill */}
      {history.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setHistoryOpen((prev) => !prev)}
            aria-expanded={historyOpen}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
          >
            <span>History ({history.length})</span>
            <span>{historyOpen ? "−" : "+"}</span>
          </button>
          {historyOpen && (
            <div className="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex min-w-0 max-w-full items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
                >
                  <span className="min-w-0 max-w-full font-mono font-semibold break-words [overflow-wrap:anywhere] text-slate-800">
                    #{entry.studentNumber}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      entry.status === "returned"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {entry.status === "returned" ? "Returned" : "Removed"}
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
