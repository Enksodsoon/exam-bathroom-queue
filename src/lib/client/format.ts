import { getExamBlockMinutes } from "@/lib/domain/window";
import type { ExamConfig, WindowStatus } from "@/lib/domain/types";
import type { Locale } from "@/lib/i18n/translations";

export interface WindowStatusMeta {
  label: string;
  description: string;
  tone: "allowed" | "blocked" | "neutral";
}

export function describeWindowStatus(
  status: WindowStatus,
  config?: ExamConfig | null,
  locale: Locale = "en",
): WindowStatusMeta {
  const { first, last } = getExamBlockMinutes(config);
  const isTh = locale === "th";

  if (
    config &&
    first + last >= config.durationMinutes &&
    (status === "BEFORE_START" ||
      status === "FIRST_30_MIN" ||
      status === "LAST_20_MIN")
  ) {
    return {
      label: isTh ? "ไม่มีช่วงเปิดรับคิวปกติ" : "No normal request window",
      description: isTh
        ? "ปิดรับคิวตลอดเวลาสอบ กรุณาติดต่อผู้คุมสอบหลัก"
        : "Requests closed. Ask the controller.",
      tone: "blocked",
    };
  }
  switch (status) {
    case "UNCONFIGURED":
      return {
        label: isTh ? "ยังไม่ตั้งเวลา" : "Unconfigured",
        description: isTh ? "ยังไม่ได้ตั้งเวลาสอบ" : "Timer not set.",
        tone: "neutral",
      };
    case "BEFORE_START":
      return {
        label: isTh ? "ยังไม่เริ่มสอบ (ปิดคิว)" : "Before Start (Blocked)",
        description: isTh
          ? first === 0
            ? "เปิดรับคิวเมื่อเริ่มสอบ"
            : `เปิดรับคิวหลังเริ่มสอบ ${first} นาที`
          : first === 0
            ? "Opens at exam start."
            : `Opens ${first} min after start.`,
        tone: "blocked",
      };
    case "FIRST_30_MIN":
      return {
        label: isTh
          ? `${first} นาทีแรก (ปิดคิว)`
          : `First ${first} Minutes (Blocked)`,
        description: isTh
          ? `เปิดรับคิวหลังเริ่มสอบ ${first} นาที`
          : `Opens ${first} min after start.`,
        tone: "blocked",
      };
    case "ALLOWED":
      return {
        label: isTh ? "เปิดรับคิวเข้าห้องน้ำ" : "Bathroom Window Open",
        description: isTh ? "ส่งคิวเข้าห้องน้ำได้ตามปกติ" : "Requests open.",
        tone: "allowed",
      };
    case "LAST_20_MIN":
      return {
        label: isTh
          ? `${last} นาทีสุดท้าย (ปิดคิว)`
          : `Last ${last} Minutes (Blocked)`,
        description: isTh
          ? `งดรับคิว ${last} นาทีสุดท้ายก่อนหมดเวลา`
          : `Final ${last} min. Requests closed.`,
        tone: "blocked",
      };
    case "AFTER_END":
      return {
        label: isTh ? "หมดเวลาสอบ (ปิดคิว)" : "Exam Ended (Blocked)",
        description: isTh ? "ปิดรับคิวแล้ว" : "Requests closed.",
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
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/70 dark:bg-emerald-950/60 dark:text-emerald-200";
    case "blocked":
      return "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/70 dark:bg-rose-950/60 dark:text-rose-200";
    case "neutral":
      return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/60 dark:text-amber-200";
  }
}
