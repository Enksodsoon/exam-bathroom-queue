import { describe, expect, it } from "vitest";
import {
  applyEntryAction,
  applyUndo,
  createSession,
  DomainError,
  joinStaff,
  reorderQueuedEntry,
  submitStudent,
  toSessionSnapshot,
  updateExamConfig,
} from "@/lib/domain";
import { buildSessionCsv } from "@/lib/client/exportCsv";

describe("applyUndo & buildSessionCsv", () => {
  it("undoes enter, return, remove, and reorder and enforces 409 when occupied", () => {
    const t0 = 1_700_000_000_000;
    let session = createSession(t0);
    session = updateExamConfig(
      session,
      { startTimeMs: t0 - 40 * 60_000, durationMinutes: 120 },
      t0,
    );
    const joined = joinStaff(session, { label: "Row A" }, t0);
    session = joined.session;

    const s1 = submitStudent(
      session,
      { sex: "M", studentNumber: "101", submittedBy: "Row A", staffId: joined.staff.id },
      t0 + 1000,
    );
    const s2 = submitStudent(
      s1.session,
      { sex: "M", studentNumber: "102", submittedBy: "Row A", staffId: joined.staff.id },
      t0 + 2000,
    );
    session = s2.session;

    // Reorder 102 up, then undo reorder
    session = reorderQueuedEntry(session, { entryId: s2.entry.id, direction: "up" }, t0 + 3000);
    expect(session.entries[0].studentNumber).toBe("102");
    session = applyUndo(session, { actorKey: "controller", isController: true }, t0 + 4000);
    expect(session.entries[0].studentNumber).toBe("101");

    // Staff marks 101 enter, then staff undoes their own enter
    session = applyEntryAction(
      session,
      { entryId: s1.entry.id, action: "enter", actorKey: `staff:${joined.staff.id}` },
      t0 + 5000,
    ).session;
    expect(session.entries[0].status).toBe("in_bathroom");
    session = applyUndo(
      session,
      { actorKey: `staff:${joined.staff.id}`, isController: false },
      t0 + 6000,
    );
    expect(session.entries[0].status).toBe("queued");

    // Enter 101 -> Staff returns 101 -> Controller enters 102 -> Staff undo Return 101 fails with BATHROOM_OCCUPIED
    session = applyEntryAction(
      session,
      { entryId: s1.entry.id, action: "enter", actorKey: "controller" },
      t0 + 7000,
    ).session;
    session = applyEntryAction(
      session,
      { entryId: s1.entry.id, action: "return", actorKey: `staff:${joined.staff.id}` },
      t0 + 8000,
    ).session;
    session = applyEntryAction(
      session,
      { entryId: s2.entry.id, action: "enter", actorKey: "controller" },
      t0 + 9000,
    ).session;

    expect(() =>
      applyUndo(session, { actorKey: `staff:${joined.staff.id}`, isController: false }, t0 + 10_000),
    ).toThrow(DomainError);

    // Controller undoes enter of 102, then staff undo return of 101 succeeds
    session = applyUndo(session, { actorKey: "controller", isController: true }, t0 + 10_000);
    session = applyUndo(session, { actorKey: `staff:${joined.staff.id}`, isController: false }, t0 + 11_000);
    expect(session.entries[0].status).toBe("in_bathroom");
    expect(session.entries[0].returnedAt).toBeNull();
  });

  it("builds UTF-8 BOM CSV with exam metadata and student durations", () => {
    const t0 = 1_700_000_000_000;
    let session = createSession(t0);
    session = updateExamConfig(
      session,
      { startTimeMs: t0 - 40 * 60_000, durationMinutes: 120 },
      t0,
    );
    const sub = submitStudent(
      session,
      { sex: "F", studentNumber: "205", submittedBy: "แถว B", override: true },
      t0 + 1000,
    );
    session = applyEntryAction(
      sub.session,
      { entryId: sub.entry.id, action: "enter" },
      t0 + 2000,
    ).session;
    session = applyEntryAction(
      session,
      { entryId: sub.entry.id, action: "return" },
      t0 + 62_000,
    ).session;

    const snapshot = toSessionSnapshot(session, t0 + 65_000);
    const csvEn = buildSessionCsv(snapshot, "en");
    expect(csvEn.startsWith("\uFEFF")).toBe(true);
    expect(csvEn).toContain("ExamQ Bathroom Queue Export");
    expect(csvEn).toContain("205,Female (F),returned,แถว B,Yes");
    expect(csvEn).toContain(",60,");

    const csvTh = buildSessionCsv(snapshot, "th");
    expect(csvTh).toContain("รายงานคิวห้องน้ำสอบ ExamQ");
    expect(csvTh).toContain("หญิง (F)");
  });
});
