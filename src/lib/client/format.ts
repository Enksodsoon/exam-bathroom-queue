import { getExamBlockMinutes } from "@/lib/domain/window";
import type { ExamConfig, WindowStatus } from "@/lib/domain/types";

export interface WindowStatusMeta {
  label: string;
  description: string;
  tone: "allowed" | "blocked" | "neutral";
}

export function describeWindowStatus(
  status: WindowStatus,
  config?: ExamConfig | null,
): WindowStatusMeta {
  const { first, last } = getExamBlockMinutes(config);
  if (config && first + last >= config.durationMinutes &&
    (status === "BEFORE_START" || status === "FIRST_30_MIN" || status === "LAST_20_MIN")) {
    return {
      label: "No normal request window",
      description: "The opening and closing blocks cover the whole exam. Contact the controller if needed.",
      tone: "blocked",
    };
  }
  switch (status) {
    case "UNCONFIGURED":
      return {
        label: "Unconfigured",
        description:
          "Exam start time and duration must be saved by the controller before staff submissions open.",
        tone: "neutral",
      };
    case "BEFORE_START":
      return {
        label: "Before Start (Blocked)",
        description:
          first === 0 ? "The queue opens when the exam starts." :
          `The queue opens ${first} minutes after the exam starts.`,
        tone: "blocked",
      };
    case "FIRST_30_MIN":
      return {
        label: `First ${first} Minutes (Blocked)`,
        description:
          `Requests are paused for the first ${first} minutes of the exam.`,
        tone: "blocked",
      };
    case "ALLOWED":
      return {
        label: "Bathroom Window Open",
        description:
          "Roaming staff can submit students and controller can mark entries into the bathroom.",
        tone: "allowed",
      };
    case "LAST_20_MIN":
      return {
        label: `Last ${last} Minutes (Blocked)`,
        description:
          `Requests are paused for the final ${last} minutes of the exam.`,
        tone: "blocked",
      };
    case "AFTER_END":
      return {
        label: "Exam Ended (Blocked)",
        description:
          "The exam duration has elapsed. Roaming staff submissions are closed.",
        tone: "blocked",
      };
  }
}

export function formatTimeOnly(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function fromDateTimeLocalValue(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function windowBadgeClasses(tone: WindowStatusMeta["tone"]): string {
  switch (tone) {
    case "allowed":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "blocked":
      return "border-rose-300 bg-rose-50 text-rose-800";
    case "neutral":
      return "border-amber-300 bg-amber-50 text-amber-900";
  }
}
