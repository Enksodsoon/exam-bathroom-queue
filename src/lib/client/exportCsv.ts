import type { SessionSnapshot } from "@/lib/domain/types";
import type { Locale } from "@/lib/i18n/translations";

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatIsoOrEmpty(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toISOString();
}

function formatLocalOrEmpty(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toLocaleString();
}

export function buildSessionCsv(
  snapshot: SessionSnapshot,
  locale: Locale = "en",
): string {
  const rows: string[][] = [];
  const cfg = snapshot.examConfig;
  const isTh = locale === "th";

  rows.push([isTh ? "รายงานคิวห้องน้ำสอบ ExamQ" : "ExamQ Bathroom Queue Export"]);
  rows.push([isTh ? "รหัสห้องสอบ (Session ID)" : "Session ID", snapshot.id]);
  rows.push([isTh ? "เวลาส่งออกข้อมูล" : "Exported At", formatLocalOrEmpty(snapshot.effectiveNowMs)]);
  rows.push([isTh ? "สถานะช่วงเวลา" : "Window Status", snapshot.windowStatus]);
  rows.push([
    isTh ? "เวลาเริ่มสอบ" : "Exam Start Time",
    cfg ? formatLocalOrEmpty(cfg.startTimeMs) : isTh ? "ยังไม่ตั้งค่า" : "Unconfigured",
  ]);
  rows.push([
    isTh ? "ระยะเวลาสอบ (นาที)" : "Exam Duration (min)",
    cfg ? String(cfg.durationMinutes) : "",
  ]);
  rows.push([
    isTh ? "งดช่วงต้น / ช่วงท้าย (นาที)" : "Block First / Last (min)",
    cfg ? `${cfg.firstBlockMinutes ?? 30} / ${cfg.lastBlockMinutes ?? 20}` : "",
  ]);
  rows.push([
    isTh ? "จำนวนผู้ช่วยคุมสอบที่เข้าร่วม" : "Connected Staff Count",
    String(snapshot.staff.length),
  ]);
  rows.push([
    isTh ? "รายชื่อผู้ช่วยคุมสอบ" : "Connected Staff",
    snapshot.staff.map((s) => s.label).join("; "),
  ]);
  rows.push([]);

  rows.push([
    isTh ? "ลำดับ" : "Seq",
    isTh ? "เลขประจำตัวนักศึกษา" : "Student Number",
    isTh ? "เพศ" : "Gender",
    isTh ? "สถานะ" : "Status",
    isTh ? "ผู้ส่งคิว" : "Submitted By",
    isTh ? "กรณีพิเศษ (Override)" : "Override",
    isTh ? "เวลาเข้าคิว (Local)" : "Queued At (Local)",
    isTh ? "เวลาเข้าห้องน้ำ (Local)" : "Entered At (Local)",
    isTh ? "เวลากลับเข้าห้อง (Local)" : "Returned At (Local)",
    isTh ? "ระยะเวลาในห้องน้ำ (วินาที)" : "Duration in Bathroom (sec)",
    "Queued At (ISO)",
    "Entered At (ISO)",
    "Returned At (ISO)",
  ]);

  const sortedEntries = [...snapshot.entries].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  sortedEntries.forEach((entry, index) => {
    const durationSec =
      entry.enteredAt !== null && entry.returnedAt !== null
        ? Math.max(0, Math.round((entry.returnedAt - entry.enteredAt) / 1000))
        : "";
    rows.push([
      String(index + 1),
      entry.studentNumber,
      entry.sex === "M" ? (isTh ? "ชาย (M)" : "Male (M)") : isTh ? "หญิง (F)" : "Female (F)",
      entry.status,
      entry.submittedBy,
      entry.override ? "Yes" : "No",
      formatLocalOrEmpty(entry.createdAt),
      formatLocalOrEmpty(entry.enteredAt),
      formatLocalOrEmpty(entry.returnedAt),
      String(durationSec),
      formatIsoOrEmpty(entry.createdAt),
      formatIsoOrEmpty(entry.enteredAt),
      formatIsoOrEmpty(entry.returnedAt),
    ]);
  });

  const csvBody = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n");

  // UTF-8 BOM ensures Excel opens Thai & Unicode characters cleanly
  return `\uFEFF${csvBody}`;
}

export function downloadSessionCsv(
  snapshot: SessionSnapshot,
  locale: Locale = "en",
): void {
  const csv = buildSessionCsv(snapshot, locale);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date(snapshot.effectiveNowMs)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `examq-log-${snapshot.id}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
