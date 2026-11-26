"use client";

import { getExamBlockMinutes, MS_PER_MINUTE } from "@/lib/domain/window";
import type { ExamConfig, WindowStatus } from "@/lib/domain/types";

interface ExamTimelineBarProps {
  examConfig: ExamConfig | null;
  effectiveNowMs: number;
  windowStatus: WindowStatus;
  compact?: boolean;
}

export function ExamTimelineBar({
  examConfig,
  effectiveNowMs,
  windowStatus,
  compact = false,
}: ExamTimelineBarProps) {
  if (!examConfig) {
    return (
      <div
        aria-label="Exam timeline not configured"
        className={`flex items-center gap-1 overflow-hidden rounded-full bg-slate-200/70 ${
          compact ? "h-1.5 w-24 sm:w-32" : "h-2 w-full"
        }`}
      >
        <div className="h-full w-full bg-slate-300/60" />
      </div>
    );
  }

  const { first, last } = getExamBlockMinutes(examConfig);
  const totalMs = Math.max(1, examConfig.durationMinutes * MS_PER_MINUTE);
  const startLockPct = Math.min(100, (first * MS_PER_MINUTE * 100) / totalMs);
  const endLockPct = Math.min(100 - startLockPct, (last * MS_PER_MINUTE * 100) / totalMs);
  const openPct = Math.max(0, 100 - startLockPct - endLockPct);

  const elapsedMs = effectiveNowMs - examConfig.startTimeMs;
  const progressPct = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));

  const needleColor =
    windowStatus === "ALLOWED"
      ? "bg-emerald-600"
      : windowStatus === "BEFORE_START" || windowStatus === "FIRST_30_MIN"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div
      aria-label={`Exam bathroom window timeline: first ${first} minutes blocked, final ${last} minutes blocked`}
      className={`relative flex items-center overflow-hidden rounded-full bg-slate-200/80 ${
        compact ? "h-2 w-24 sm:w-36" : "h-2.5 w-full"
      }`}
    >
      <div
        style={{ width: `${startLockPct}%` }}
        className="h-full bg-amber-300/80"
        title={`First ${first}m locked`}
      />
      <div
        style={{ width: `${openPct}%` }}
        className="h-full bg-emerald-400/85"
        title="Open bathroom window"
      />
      <div
        style={{ width: `${endLockPct}%` }}
        className="h-full bg-rose-300/80"
        title={`Last ${last}m locked`}
      />
      <span
        style={{ left: `calc(${progressPct}% - 3px)` }}
        className={`absolute top-0 bottom-0 w-1.5 rounded-full ring-2 ring-white ${needleColor}`}
      />
    </div>
  );
}
