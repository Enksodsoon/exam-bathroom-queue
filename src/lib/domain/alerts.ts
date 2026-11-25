import {
  DomainError,
  type AlertInfo,
  type NextBySex,
  type QueueEntry,
} from "./types";

export function computeNextBySex(entries: readonly QueueEntry[]): NextBySex {
  let maleNext: string | null = null;
  let femaleNext: string | null = null;

  for (const entry of entries) {
    if (entry.status !== "queued") {
      continue;
    }
    if (entry.sex === "M" && maleNext === null) {
      maleNext = entry.id;
    } else if (entry.sex === "F" && femaleNext === null) {
      femaleNext = entry.id;
    }
    if (maleNext !== null && femaleNext !== null) {
      break;
    }
  }

  return { M: maleNext, F: femaleNext };
}

export interface ReconcileNextParams {
  prevNextBySex: NextBySex;
  entries: readonly QueueEntry[];
  prevAlertSeq: number;
  prevLastNextAlert: AlertInfo | null;
  triggeredAt: number;
}

export interface ReconcileNextResult {
  nextBySex: NextBySex;
  alertSeq: number;
  lastNextAlert: AlertInfo | null;
}

export function reconcileNextAndAlerts(
  params: ReconcileNextParams,
): ReconcileNextResult {
  if (
    typeof params.triggeredAt !== "number" ||
    !Number.isFinite(params.triggeredAt)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "triggeredAt must be a finite number",
    );
  }

  const nextBySex = computeNextBySex(params.entries);
  let alertSeq = params.prevAlertSeq;
  let lastNextAlert: AlertInfo | null = params.prevLastNextAlert
    ? { ...params.prevLastNextAlert }
    : null;

  for (const sex of ["M", "F"] as const) {
    const nextId = nextBySex[sex];
    if (nextId !== null && nextId !== params.prevNextBySex[sex]) {
      const entry = params.entries.find((item) => item.id === nextId);
      if (!entry) {
        throw new DomainError(
          "INVALID_STATE",
          `Next queued entry '${nextId}' missing from entries`,
        );
      }
      alertSeq += 1;
      lastNextAlert = {
        seq: alertSeq,
        sex,
        entryId: entry.id,
        studentNumber: entry.studentNumber,
        triggeredAt: params.triggeredAt,
      };
    }
  }

  return {
    nextBySex,
    alertSeq,
    lastNextAlert,
  };
}
