"use client";

import type { EntryAction, QueueEntry, Sex } from "@/lib/domain/types";
import { formatTimeOnly } from "@/lib/client/format";

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
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ${
              sex === "M"
                ? "bg-sky-100 text-sky-900"
                : "bg-fuchsia-100 text-fuchsia-900"
            }`}
          >
            {sex}
          </span>
          <h2 className="text-lg font-semibold text-slate-900">
            {sexLabel} Queue
          </h2>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {queued.length} waiting
        </span>
      </div>

      {/* Current Occupancy */}
      <div
        data-testid={`occupancy-${sex}`}
        data-occupancy={inBathroom ? "occupied" : "vacant"}
        aria-label={`${sexLabel} Bathroom Occupancy`}
        className={`rounded-lg border p-3 ${
          inBathroom
            ? "border-amber-300 bg-amber-50/70"
            : "border-emerald-200 bg-emerald-50/50"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-slate-600 uppercase">
            Currently In Bathroom
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              inBathroom
                ? "bg-amber-200 text-amber-950"
                : "bg-emerald-200 text-emerald-950"
            }`}
          >
            {inBathroom ? "Occupied" : "Vacant"}
          </span>
        </div>

        {inBathroom ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 max-w-full">
              <p className="min-w-0 max-w-full text-base font-bold break-words [overflow-wrap:anywhere] text-slate-900">
                #{inBathroom.studentNumber}
                {inBathroom.override && (
                  <span className="ml-2 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-800">
                    Override
                  </span>
                )}
              </p>
              <p className="min-w-0 max-w-full text-xs break-words [overflow-wrap:anywhere] text-slate-600">
                Submitted by {inBathroom.submittedBy}
                {inBathroom.enteredAt !== null
                  ? ` · Entered ${formatTimeOnly(inBathroom.enteredAt)}`
                  : ""}
              </p>
            </div>
            {mode === "controller" && onEntryAction && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isEntryBusy(inBathroom.id)}
                  onClick={() => onEntryAction(inBathroom.id, "return")}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50"
                >
                  Mark Returned
                </button>
                <button
                  type="button"
                  disabled={isEntryBusy(inBathroom.id)}
                  onClick={() => onEntryAction(inBathroom.id, "remove")}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-slate-600">
            {sexLabel} bathroom is currently vacant.
          </p>
        )}
      </div>

      {/* Waiting FIFO Queue */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">
          Waiting Queue (FIFO)
        </h3>

        {queued.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
            No {sexLabel.toLowerCase()} students waiting.
          </p>
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
                  className={`rounded-lg border p-3 transition ${
                    isNext
                      ? "border-indigo-300 bg-indigo-50/50"
                      : "border-slate-200 bg-slate-50/60"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 max-w-full space-y-0.5">
                      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500">
                          #{idx + 1}
                        </span>
                        <span className="min-w-0 max-w-full text-base font-bold break-words [overflow-wrap:anywhere] text-slate-900">
                          #{entry.studentNumber}
                        </span>
                        {isNext && (
                          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">
                            NEXT
                          </span>
                        )}
                        {entry.override && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-800">
                            Override
                          </span>
                        )}
                      </div>
                      <p className="min-w-0 max-w-full text-xs break-words [overflow-wrap:anywhere] text-slate-600">
                        Submitted by {entry.submittedBy} ·{" "}
                        {formatTimeOnly(entry.createdAt)}
                      </p>
                    </div>
                  </div>

                  {mode === "controller" && onEntryAction && onReorder && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEntryAction(entry.id, "enter")}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                      >
                        Enter Bathroom
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || idx === 0}
                        onClick={() => onReorder(entry.id, "up")}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Move Up
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || idx === queued.length - 1}
                        onClick={() => onReorder(entry.id, "down")}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Move Down
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onEntryAction(entry.id, "remove")}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Completed / Returned History */}
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">
          Completed / Removed ({history.length})
        </h3>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">No completed entries yet.</p>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
              >
                <span className="min-w-0 max-w-full font-semibold break-words [overflow-wrap:anywhere] text-slate-900">
                  #{entry.studentNumber}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 font-medium ${
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
    </section>
  );
}
