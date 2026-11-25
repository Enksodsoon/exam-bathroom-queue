import { describe, expect, it } from "vitest";
import {
  DomainError,
  applyEntryAction,
  clearSession,
  computeNextBySex,
  createSession,
  evaluateExamWindow,
  getExamWindowBounds,
  joinStaff,
  reconcileNextAndAlerts,
  reorderQueuedEntry,
  submitStudent,
  toSessionSnapshot,
  updateExamConfig,
  type ExamConfig,
  type ExamSession,
} from "@/lib/domain";

const MIN = 60_000;
const BASE_START = 1_700_000_000_000;

function makeSeqIdGen(prefix = "id"): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

function makeConfiguredSession(
  durationMinutes = 120,
  clockOffsetMs = 0,
): ExamSession {
  const idGen = makeSeqIdGen("init");
  const session = createSession(BASE_START - 10 * MIN, {
    id: "sess-1",
    controllerKey: "ctrl-secret",
    idGenerator: idGen,
  });
  return updateExamConfig(
    session,
    {
      startTimeMs: BASE_START,
      durationMinutes,
      clockOffsetMs,
    },
    BASE_START - 5 * MIN,
  );
}

describe("Domain Engine", () => {
  describe("1. Session & Snapshot", () => {
    it("initializes session defaults and redacts controllerKey and alertSeq in snapshot", () => {
      const idGen = makeSeqIdGen("s");
      const session = createSession(1_000_000, { idGenerator: idGen });

      expect(session.id).toBe("s-1");
      expect(session.controllerKey).toBe("s-2");
      expect(session.createdAt).toBe(1_000_000);
      expect(session.version).toBe(1);
      expect(session.clearedSeq).toBe(0);
      expect(session.alertSeq).toBe(0);
      expect(session.examConfig).toBeNull();
      expect(session.entries).toEqual([]);
      expect(session.staff).toEqual([]);
      expect(session.nextBySex).toEqual({ M: null, F: null });
      expect(session.lastNextAlert).toBeNull();

      const snapshot = toSessionSnapshot(session, 1_005_000);
      expect("controllerKey" in snapshot).toBe(false);
      expect("alertSeq" in snapshot).toBe(false);
      expect(snapshot).toEqual({
        id: "s-1",
        createdAt: 1_000_000,
        version: 1,
        clearedSeq: 0,
        serverNowMs: 1_005_000,
        effectiveNowMs: 1_005_000,
        windowStatus: "UNCONFIGURED",
        examConfig: null,
        entries: [],
        staff: [],
        nextBySex: { M: null, F: null },
        lastNextAlert: null,
      });
    });

    it("maintains strict immutability across domain transitions and snapshot cloning", () => {
      const idGen = makeSeqIdGen("imm");
      const s0 = makeConfiguredSession(120);
      const allowedNow = BASE_START + 45 * MIN;
      const { session: s1 } = joinStaff(s0, { label: "Hall A" }, allowedNow, {
        idGenerator: idGen,
      });
      const { session: s2, entry } = submitStudent(
        s1,
        { sex: "M", studentNumber: "1001" },
        allowedNow,
        { idGenerator: idGen },
      );

      expect(s0.staff).toHaveLength(0);
      expect(s0.entries).toHaveLength(0);
      expect(s1.entries).toHaveLength(0);
      expect(s2.entries).toHaveLength(1);

      const snap = toSessionSnapshot(s2, allowedNow);
      snap.entries[0].studentNumber = "MUTATED";
      snap.staff[0].label = "MUTATED";
      snap.nextBySex.M = "MUTATED";
      if (snap.examConfig) snap.examConfig.durationMinutes = 999;
      if (snap.lastNextAlert) snap.lastNextAlert.studentNumber = "MUTATED";

      expect(entry.studentNumber).toBe("1001");
      expect(s2.entries[0].studentNumber).toBe("1001");
      expect(s2.staff[0].label).toBe("Hall A");
      expect(s2.nextBySex.M).toBe(entry.id);
      expect(s2.examConfig?.durationMinutes).toBe(120);
      expect(s2.lastNextAlert?.studentNumber).toBe("1001");
    });

    it("rejects non-finite nowMs or blank ids in createSession", () => {
      expect(() => createSession(Number.NaN)).toThrow(DomainError);
      expect(() =>
        createSession(1000, { id: "   ", controllerKey: "abc" }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        createSession(1000, { id: "abc", controllerKey: "" }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    });
  });

  describe("2. Staff Join", () => {
    it("trims labels, enforces 1..40 length, and reuses staffId case-insensitively", () => {
      const idGen = makeSeqIdGen("st");
      const s0 = createSession(1000, { id: "s1", controllerKey: "k1" });

      const r1 = joinStaff(s0, { label: "  Room 1  " }, 2000, {
        idGenerator: idGen,
      });
      expect(r1.staff).toEqual({
        id: "st-1",
        label: "Room 1",
        joinedAt: 2000,
        lastSeenAt: 2000,
      });
      expect(r1.session.version).toBe(2);

      // Rejoin with different casing updates lastSeenAt and label, preserves id & joinedAt
      const r2 = joinStaff(r1.session, { label: "room 1" }, 5000, {
        idGenerator: idGen,
      });
      expect(r2.staff).toEqual({
        id: "st-1",
        label: "room 1",
        joinedAt: 2000,
        lastSeenAt: 5000,
      });
      expect(r2.session.staff).toHaveLength(1);
      expect(r2.session.version).toBe(3);

      // Exact 40 chars accepted
      const exact40 = "A".repeat(40);
      const r3 = joinStaff(r2.session, { label: exact40 }, 6000, {
        idGenerator: idGen,
      });
      expect(r3.staff.label).toBe(exact40);
      expect(r3.session.staff).toHaveLength(2);

      // Invalid labels rejected
      expect(() => joinStaff(s0, { label: "" }, 2000)).toThrowError(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(() => joinStaff(s0, { label: "   \t  " }, 2000)).toThrowError(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(() => joinStaff(s0, { label: "A".repeat(41) }, 2000)).toThrowError(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });
  });

  describe("3. Time Window (evaluateExamWindow & updateExamConfig)", () => {
    it("returns UNCONFIGURED when examConfig is null", () => {
      expect(evaluateExamWindow(null, BASE_START)).toEqual({
        windowStatus: "UNCONFIGURED",
        effectiveNowMs: BASE_START,
      });
    });

    it("evaluates exact millisecond boundaries for a 120-minute exam", () => {
      const config: ExamConfig = {
        startTimeMs: BASE_START,
        durationMinutes: 120,
      };
      const end = BASE_START + 120 * MIN;
      const bounds = getExamWindowBounds(config);
      expect(bounds).toEqual({
        startMs: BASE_START,
        endMs: end,
        allowStartMs: BASE_START + 30 * MIN,
        allowEndMs: end - 20 * MIN,
      });

      expect(evaluateExamWindow(config, BASE_START - 1).windowStatus).toBe(
        "BEFORE_START",
      );
      expect(evaluateExamWindow(config, BASE_START).windowStatus).toBe(
        "FIRST_30_MIN",
      );
      expect(
        evaluateExamWindow(config, BASE_START + 30 * MIN - 1).windowStatus,
      ).toBe("FIRST_30_MIN");
      expect(
        evaluateExamWindow(config, BASE_START + 30 * MIN).windowStatus,
      ).toBe("ALLOWED");
      expect(evaluateExamWindow(config, end - 20 * MIN - 1).windowStatus).toBe(
        "ALLOWED",
      );
      expect(evaluateExamWindow(config, end - 20 * MIN).windowStatus).toBe(
        "LAST_20_MIN",
      );
      expect(evaluateExamWindow(config, end - 1).windowStatus).toBe(
        "LAST_20_MIN",
      );
      expect(evaluateExamWindow(config, end).windowStatus).toBe("AFTER_END");
    });

    it("applies positive and negative clockOffsetMs to effectiveNowMs", () => {
      const now = BASE_START + 10 * MIN; // normally FIRST_30_MIN
      const plusConfig: ExamConfig = {
        startTimeMs: BASE_START,
        durationMinutes: 120,
        clockOffsetMs: 25 * MIN,
      };
      const resPlus = evaluateExamWindow(plusConfig, now);
      expect(resPlus.effectiveNowMs).toBe(BASE_START + 35 * MIN);
      expect(resPlus.windowStatus).toBe("ALLOWED");

      const minusConfig: ExamConfig = {
        startTimeMs: BASE_START,
        durationMinutes: 120,
        clockOffsetMs: -15 * MIN,
      };
      const resMinus = evaluateExamWindow(minusConfig, now);
      expect(resMinus.effectiveNowMs).toBe(BASE_START - 5 * MIN);
      expect(resMinus.windowStatus).toBe("BEFORE_START");
    });

    it("handles short exams (50, 40, 10 minutes) without ever allowing out-of-bounds statuses", () => {
      const cfg50: ExamConfig = { startTimeMs: BASE_START, durationMinutes: 50 };
      for (let m = 0; m < 50; m += 5) {
        const status = evaluateExamWindow(cfg50, BASE_START + m * MIN).windowStatus;
        expect(status).not.toBe("ALLOWED");
      }
      expect(
        evaluateExamWindow(cfg50, BASE_START + 30 * MIN - 1).windowStatus,
      ).toBe("FIRST_30_MIN");
      expect(
        evaluateExamWindow(cfg50, BASE_START + 30 * MIN).windowStatus,
      ).toBe("LAST_20_MIN");
      expect(
        evaluateExamWindow(cfg50, BASE_START + 50 * MIN).windowStatus,
      ).toBe("AFTER_END");

      const cfg40: ExamConfig = { startTimeMs: BASE_START, durationMinutes: 40 };
      for (let m = 0; m < 40; m += 5) {
        const status = evaluateExamWindow(cfg40, BASE_START + m * MIN).windowStatus;
        expect(status).not.toBe("ALLOWED");
      }
      expect(
        evaluateExamWindow(cfg40, BASE_START + 25 * MIN).windowStatus,
      ).toBe("FIRST_30_MIN");

      const cfg10: ExamConfig = { startTimeMs: BASE_START, durationMinutes: 10 };
      expect(evaluateExamWindow(cfg10, BASE_START - 1).windowStatus).toBe(
        "BEFORE_START",
      );
      expect(evaluateExamWindow(cfg10, BASE_START).windowStatus).toBe(
        "FIRST_30_MIN",
      );
      expect(
        evaluateExamWindow(cfg10, BASE_START + 10 * MIN - 1).windowStatus,
      ).toBe("FIRST_30_MIN");
      expect(
        evaluateExamWindow(cfg10, BASE_START + 10 * MIN).windowStatus,
      ).toBe("AFTER_END");
    });

    it("validates updateExamConfig inputs and allows startTimeMs = 0", () => {
      const s0 = createSession(1000, { id: "s1", controllerKey: "k1" });
      const s1 = updateExamConfig(
        s0,
        { startTimeMs: 0, durationMinutes: 90 },
        2000,
      );
      expect(s1.examConfig).toEqual({
        startTimeMs: 0,
        durationMinutes: 90,
        clockOffsetMs: 0,
      });
      expect(s1.version).toBe(2);

      expect(() =>
        updateExamConfig(s0, { startTimeMs: Number.NaN, durationMinutes: 90 }, 2000),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        updateExamConfig(
          s0,
          { startTimeMs: BASE_START, durationMinutes: Number.POSITIVE_INFINITY },
          2000,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        updateExamConfig(s0, { startTimeMs: BASE_START, durationMinutes: 0 }, 2000),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        updateExamConfig(
          s0,
          { startTimeMs: BASE_START, durationMinutes: 60, clockOffsetMs: Number.NaN },
          2000,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    it("rejects extreme finite values whose derived window bounds or effectiveNowMs overflow to Infinity", () => {
      const s0 = createSession(1000, { id: "s1", controllerKey: "k1" });

      expect(() =>
        getExamWindowBounds({ startTimeMs: 0, durationMinutes: 1e305 }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        updateExamConfig(
          s0,
          { startTimeMs: 0, durationMinutes: 1e305 },
          2000,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        getExamWindowBounds({
          startTimeMs: Number.MAX_VALUE,
          durationMinutes: 1e305,
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        evaluateExamWindow(
          {
            startTimeMs: 0,
            durationMinutes: 60,
            clockOffsetMs: Number.MAX_VALUE,
          },
          Number.MAX_VALUE,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        evaluateExamWindow(
          {
            startTimeMs: 0,
            durationMinutes: 60,
            clockOffsetMs: -Number.MAX_VALUE,
          },
          -Number.MAX_VALUE,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    });
  });

  describe("4. Submit Student & FIFO Queues", () => {
    it("appends separately to M and F FIFO queues, trims studentNumber, and resolves submittedBy", () => {
      const idGen = makeSeqIdGen("e");
      const allowedNow = BASE_START + 40 * MIN;
      let session = makeConfiguredSession(120);
      const joined = joinStaff(session, { label: "Proctor North" }, allowedNow, {
        idGenerator: makeSeqIdGen("st"),
      });
      session = joined.session;

      const r1 = submitStudent(
        session,
        { sex: "M", studentNumber: "  S-101  ", staffId: joined.staff.id },
        allowedNow + 1000,
        { idGenerator: idGen },
      );
      expect(r1.entry.studentNumber).toBe("S-101");
      expect(r1.entry.submittedBy).toBe("Proctor North");
      expect(r1.entry.override).toBe(false);
      expect(r1.session.staff[0].lastSeenAt).toBe(allowedNow + 1000);

      const r2 = submitStudent(
        r1.session,
        { sex: "F", studentNumber: "S-201", submittedBy: "Roaming Desk" },
        allowedNow + 2000,
        { idGenerator: idGen },
      );
      expect(r2.entry.submittedBy).toBe("Roaming Desk");

      const r3 = submitStudent(
        r2.session,
        { sex: "M", studentNumber: "S-102" },
        allowedNow + 3000,
        { idGenerator: idGen },
      );
      expect(r3.entry.submittedBy).toBe("Staff");

      const maleQueue = r3.session.entries.filter((e) => e.sex === "M");
      const femaleQueue = r3.session.entries.filter((e) => e.sex === "F");
      expect(maleQueue.map((e) => e.studentNumber)).toEqual(["S-101", "S-102"]);
      expect(femaleQueue.map((e) => e.studentNumber)).toEqual(["S-201"]);
    });

    it("validates sex and studentNumber boundaries (1..32 chars)", () => {
      const allowedNow = BASE_START + 40 * MIN;
      const session = makeConfiguredSession(120);

      expect(() =>
        submitStudent(
          session,
          { sex: "X" as "M", studentNumber: "100" },
          allowedNow,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        submitStudent(session, { sex: "M", studentNumber: "   " }, allowedNow),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        submitStudent(
          session,
          { sex: "M", studentNumber: "9".repeat(33) },
          allowedNow,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      const ok32 = submitStudent(
        session,
        { sex: "F", studentNumber: "9".repeat(32) },
        allowedNow,
        { idGenerator: makeSeqIdGen("len") },
      );
      expect(ok32.entry.studentNumber).toHaveLength(32);
    });

    it("rejects duplicate active student (case-insensitive) and allows resubmission after return/remove", () => {
      const idGen = makeSeqIdGen("dup");
      const allowedNow = BASE_START + 40 * MIN;
      let session = makeConfiguredSession(120);

      const s1 = submitStudent(
        session,
        { sex: "M", studentNumber: "ab-12" },
        allowedNow,
        { idGenerator: idGen },
      );
      session = s1.session;

      // Duplicate while queued (even different case or different sex)
      expect(() =>
        submitStudent(
          session,
          { sex: "F", studentNumber: " AB-12 " },
          allowedNow + 1000,
        ),
      ).toThrowError(expect.objectContaining({ code: "DUPLICATE_STUDENT" }));

      // Duplicate while in_bathroom
      session = applyEntryAction(
        session,
        { entryId: s1.entry.id, action: "enter" },
        allowedNow + 2000,
      ).session;
      expect(() =>
        submitStudent(
          session,
          { sex: "M", studentNumber: "ab-12" },
          allowedNow + 3000,
        ),
      ).toThrowError(expect.objectContaining({ code: "DUPLICATE_STUDENT" }));

      // Allowed after return
      session = applyEntryAction(
        session,
        { entryId: s1.entry.id, action: "return" },
        allowedNow + 4000,
      ).session;
      const s2 = submitStudent(
        session,
        { sex: "M", studentNumber: "ab-12" },
        allowedNow + 5000,
        { idGenerator: idGen },
      );
      expect(s2.entry.id).not.toBe(s1.entry.id);

      // Allowed after remove
      session = applyEntryAction(
        s2.session,
        { entryId: s2.entry.id, action: "remove" },
        allowedNow + 6000,
      ).session;
      const s3 = submitStudent(
        session,
        { sex: "M", studentNumber: "AB-12" },
        allowedNow + 7000,
        { idGenerator: idGen },
      );
      expect(s3.entry.status).toBe("queued");
    });

    it("blocks submissions outside ALLOWED window and permits controller override", () => {
      const unconfigured = createSession(BASE_START, {
        id: "u1",
        controllerKey: "k1",
      });
      expect(() =>
        submitStudent(unconfigured, { sex: "M", studentNumber: "100" }, BASE_START),
      ).toThrowError(
        expect.objectContaining({
          code: "OUTSIDE_TIME_WINDOW",
          windowStatus: "UNCONFIGURED",
        }),
      );

      const session = makeConfiguredSession(120);
      const end = BASE_START + 120 * MIN;
      const blockedTimes: Array<[number, string]> = [
        [BASE_START - 1000, "BEFORE_START"],
        [BASE_START + 5 * MIN, "FIRST_30_MIN"],
        [end - 10 * MIN, "LAST_20_MIN"],
        [end + 1000, "AFTER_END"],
      ];

      for (const [ts, expectedStatus] of blockedTimes) {
        expect(() =>
          submitStudent(session, { sex: "M", studentNumber: "100" }, ts),
        ).toThrowError(
          expect.objectContaining({
            code: "OUTSIDE_TIME_WINDOW",
            windowStatus: expectedStatus,
          }),
        );

        const overridden = submitStudent(
          session,
          { sex: "M", studentNumber: "100", override: true },
          ts,
          { idGenerator: makeSeqIdGen("ovr") },
        );
        expect(overridden.entry.override).toBe(true);
        expect(overridden.entry.submittedBy).toBe("Controller");
      }
    });
  });

  describe("5. Occupancy & Entry Actions", () => {
    it("allows 1 M and 1 F in_bathroom concurrently and rejects 2nd same-sex enter even with override", () => {
      const idGen = makeSeqIdGen("occ");
      const now = BASE_START + 45 * MIN;
      let session = makeConfiguredSession(120);

      const m1 = submitStudent(session, { sex: "M", studentNumber: "M1" }, now, {
        idGenerator: idGen,
      });
      const m2 = submitStudent(
        m1.session,
        { sex: "M", studentNumber: "M2" },
        now + 100,
        { idGenerator: idGen },
      );
      const f1 = submitStudent(
        m2.session,
        { sex: "F", studentNumber: "F1" },
        now + 200,
        { idGenerator: idGen },
      );
      const f2 = submitStudent(
        f1.session,
        { sex: "F", studentNumber: "F2" },
        now + 300,
        { idGenerator: idGen },
      );
      session = f2.session;

      session = applyEntryAction(
        session,
        { entryId: m1.entry.id, action: "enter" },
        now + 1000,
      ).session;
      session = applyEntryAction(
        session,
        { entryId: f1.entry.id, action: "enter" },
        now + 1100,
      ).session;

      const active = session.entries.filter((e) => e.status === "in_bathroom");
      expect(active.map((e) => e.studentNumber)).toEqual(["M1", "F1"]);

      // 2nd Male rejected even with override: true
      expect(() =>
        applyEntryAction(
          session,
          { entryId: m2.entry.id, action: "enter", override: true },
          now + 1200,
        ),
      ).toThrowError(expect.objectContaining({ code: "BATHROOM_OCCUPIED" }));

      // 2nd Female rejected
      expect(() =>
        applyEntryAction(
          session,
          { entryId: f2.entry.id, action: "enter" },
          now + 1300,
        ),
      ).toThrowError(expect.objectContaining({ code: "BATHROOM_OCCUPIED" }));
    });

    it("enforces time-window on enter (with override) and allows return/remove anytime", () => {
      const idGen = makeSeqIdGen("act");
      const allowedNow = BASE_START + 45 * MIN;
      const last20Now = BASE_START + 105 * MIN;
      const afterEndNow = BASE_START + 125 * MIN;

      let session = makeConfiguredSession(120);
      const m1 = submitStudent(
        session,
        { sex: "M", studentNumber: "M1" },
        allowedNow,
        { idGenerator: idGen },
      );
      const m2 = submitStudent(
        m1.session,
        { sex: "M", studentNumber: "M2" },
        allowedNow + 100,
        { idGenerator: idGen },
      );
      session = m2.session;

      // Enter during LAST_20_MIN blocked without override
      expect(() =>
        applyEntryAction(
          session,
          { entryId: m1.entry.id, action: "enter" },
          last20Now,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "OUTSIDE_TIME_WINDOW",
          windowStatus: "LAST_20_MIN",
        }),
      );

      // Enter during LAST_20_MIN succeeds with override: true
      const entered = applyEntryAction(
        session,
        { entryId: m1.entry.id, action: "enter", override: true },
        last20Now,
      );
      expect(entered.entry.status).toBe("in_bathroom");
      expect(entered.entry.enteredAt).toBe(last20Now);
      expect(entered.entry.override).toBe(true);

      // Return allowed anytime (even AFTER_END) and frees slot
      const returned = applyEntryAction(
        entered.session,
        { entryId: m1.entry.id, action: "return" },
        afterEndNow,
      );
      expect(returned.entry.status).toBe("returned");
      expect(returned.entry.returnedAt).toBe(afterEndNow);

      // M2 can enter with override after M1 returned
      const m2Entered = applyEntryAction(
        returned.session,
        { entryId: m2.entry.id, action: "enter", override: true },
        afterEndNow + 1000,
      );
      expect(m2Entered.entry.status).toBe("in_bathroom");

      // Remove active entry allowed anytime (AFTER_END)
      const m2Removed = applyEntryAction(
        m2Entered.session,
        { entryId: m2.entry.id, action: "remove" },
        afterEndNow + 2000,
      );
      expect(m2Removed.entry.status).toBe("removed");
    });

    it("rejects invalid state transitions and unknown entryId", () => {
      const idGen = makeSeqIdGen("inv");
      const now = BASE_START + 45 * MIN;
      let session = makeConfiguredSession(120);
      const m1 = submitStudent(
        session,
        { sex: "M", studentNumber: "M1" },
        now,
        { idGenerator: idGen },
      );
      session = m1.session;

      expect(() =>
        applyEntryAction(session, { entryId: "missing", action: "enter" }, now),
      ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));

      // Cannot return queued
      expect(() =>
        applyEntryAction(session, { entryId: m1.entry.id, action: "return" }, now),
      ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));

      // Enter then cannot enter again
      session = applyEntryAction(
        session,
        { entryId: m1.entry.id, action: "enter" },
        now + 100,
      ).session;
      expect(() =>
        applyEntryAction(
          session,
          { entryId: m1.entry.id, action: "enter" },
          now + 200,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));

      // Return then cannot enter/return/remove
      session = applyEntryAction(
        session,
        { entryId: m1.entry.id, action: "return" },
        now + 300,
      ).session;
      for (const action of ["enter", "return", "remove"] as const) {
        expect(() =>
          applyEntryAction(
            session,
            { entryId: m1.entry.id, action },
            now + 400,
          ),
        ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
      }
    });
  });

  describe("6. Reorder Queued Entries", () => {
    it("reorders by targetIndex and direction while preserving opposite-sex and non-queued slots", () => {
      const idGen = makeSeqIdGen("re");
      const now = BASE_START + 45 * MIN;
      let session = makeConfiguredSession(120);

      const m0 = submitStudent(session, { sex: "M", studentNumber: "M0" }, now, {
        idGenerator: idGen,
      });
      const f1 = submitStudent(
        m0.session,
        { sex: "F", studentNumber: "F1" },
        now + 1,
        { idGenerator: idGen },
      );
      const m1 = submitStudent(
        f1.session,
        { sex: "M", studentNumber: "M1" },
        now + 2,
        { idGenerator: idGen },
      );
      const m2 = submitStudent(
        m1.session,
        { sex: "M", studentNumber: "M2" },
        now + 3,
        { idGenerator: idGen },
      );
      const f2 = submitStudent(
        m2.session,
        { sex: "F", studentNumber: "F2" },
        now + 4,
        { idGenerator: idGen },
      );
      const m3 = submitStudent(
        f2.session,
        { sex: "M", studentNumber: "M3" },
        now + 5,
        { idGenerator: idGen },
      );

      // Put M0 in_bathroom so M0 is non-queued at index 0
      session = applyEntryAction(
        m3.session,
        { entryId: m0.entry.id, action: "enter" },
        now + 10,
      ).session;

      // Entries slots: [M0(in_bathroom), F1(queued), M1(queued), M2(queued), F2(queued), M3(queued)]
      // Move M3 to targetIndex 0 of Male queued list
      const r1 = reorderQueuedEntry(
        session,
        { entryId: m3.entry.id, targetIndex: 0 },
        now + 20,
      );
      expect(r1.entries.map((e) => e.studentNumber)).toEqual([
        "M0",
        "F1",
        "M3",
        "M1",
        "F2",
        "M2",
      ]);
      expect(r1.nextBySex.M).toBe(m3.entry.id);
      expect(r1.nextBySex.F).toBe(f1.entry.id);

      // Move M3 down by 1 -> becomes [M1, M3, M2]
      const r2 = reorderQueuedEntry(
        r1,
        { entryId: m3.entry.id, direction: "down" },
        now + 30,
      );
      expect(
        r2.entries
          .filter((e) => e.sex === "M" && e.status === "queued")
          .map((e) => e.studentNumber),
      ).toEqual(["M1", "M3", "M2"]);
      expect(r2.nextBySex.M).toBe(m1.entry.id);

      // Move M1 up at index 0 -> boundary no-op (version unchanged)
      const r3 = reorderQueuedEntry(
        r2,
        { entryId: m1.entry.id, direction: "up" },
        now + 40,
      );
      expect(r3.version).toBe(r2.version);
      expect(r3.lastNextAlert).toEqual(r2.lastNextAlert);

      // Move M2 down at end -> boundary no-op
      const r4 = reorderQueuedEntry(
        r3,
        { entryId: m2.entry.id, direction: "down" },
        now + 50,
      );
      expect(r4.version).toBe(r3.version);

      // Error cases
      expect(() =>
        reorderQueuedEntry(
          r4,
          { entryId: m3.entry.id, targetIndex: 99 },
          now + 60,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        reorderQueuedEntry(
          r4,
          { entryId: m3.entry.id, targetIndex: -1 },
          now + 60,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        reorderQueuedEntry(
          r4,
          { entryId: m3.entry.id, targetIndex: 0.5 },
          now + 60,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(() =>
        reorderQueuedEntry(
          r4,
          { entryId: m0.entry.id, direction: "down" },
          now + 60,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(() =>
        reorderQueuedEntry(
          r4,
          { entryId: "unknown", direction: "up" },
          now + 60,
        ),
      ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    });

    it("handles explicit undefined optional keys and rejects both or neither reorder specifier", () => {
      const idGen = makeSeqIdGen("re2");
      const now = BASE_START + 45 * MIN;
      let session = makeConfiguredSession(120);

      const m1 = submitStudent(session, { sex: "M", studentNumber: "M1" }, now, {
        idGenerator: idGen,
      });
      const m2 = submitStudent(
        m1.session,
        { sex: "M", studentNumber: "M2" },
        now + 1,
        { idGenerator: idGen },
      );
      const m3 = submitStudent(
        m2.session,
        { sex: "M", studentNumber: "M3" },
        now + 2,
        { idGenerator: idGen },
      );
      session = m3.session;

      // { entryId, direction: undefined, targetIndex: 0 } reorders cleanly to index 0
      const movedToFront = reorderQueuedEntry(
        session,
        { entryId: m3.entry.id, direction: undefined, targetIndex: 0 },
        now + 10,
      );
      expect(movedToFront.entries.map((e) => e.studentNumber)).toEqual([
        "M3",
        "M1",
        "M2",
      ]);
      expect(movedToFront.nextBySex.M).toBe(m3.entry.id);

      // { entryId, targetIndex: undefined, direction: "up" } moves M2 up one slot
      const movedUp = reorderQueuedEntry(
        movedToFront,
        { entryId: m2.entry.id, targetIndex: undefined, direction: "up" },
        now + 20,
      );
      expect(movedUp.entries.map((e) => e.studentNumber)).toEqual([
        "M3",
        "M2",
        "M1",
      ]);

      // Rejects when both direction and targetIndex are defined
      expect(() =>
        reorderQueuedEntry(
          movedUp,
          {
            entryId: m1.entry.id,
            direction: "up",
            targetIndex: 0,
          } as unknown as Parameters<typeof reorderQueuedEntry>[1],
          now + 30,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      // Rejects when neither direction nor targetIndex is provided
      expect(() =>
        reorderQueuedEntry(
          movedUp,
          { entryId: m1.entry.id } as unknown as Parameters<
            typeof reorderQueuedEntry
          >[1],
          now + 30,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        reorderQueuedEntry(
          movedUp,
          {
            entryId: m1.entry.id,
            direction: undefined,
            targetIndex: undefined,
          } as unknown as Parameters<typeof reorderQueuedEntry>[1],
          now + 30,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    });
  });

  describe("7. Alerts (computeNextBySex & lastNextAlert)", () => {
    it("increments lastNextAlert.seq strictly when nextBySex head changes to a new non-null entry", () => {
      const idGen = makeSeqIdGen("al");
      const now = BASE_START + 45 * MIN;
      let session = makeConfiguredSession(120);

      // Empty -> add M1 => seq 1
      const m1 = submitStudent(session, { sex: "M", studentNumber: "M1" }, now, {
        idGenerator: idGen,
      });
      session = m1.session;
      expect(session.lastNextAlert).toMatchObject({
        seq: 1,
        sex: "M",
        entryId: m1.entry.id,
        studentNumber: "M1",
      });

      // Add M2 => head stays M1 => seq stays 1
      const m2 = submitStudent(
        session,
        { sex: "M", studentNumber: "M2" },
        now + 100,
        { idGenerator: idGen },
      );
      session = m2.session;
      expect(session.lastNextAlert?.seq).toBe(1);

      // Add F1 => F head becomes F1 => seq 2
      const f1 = submitStudent(
        session,
        { sex: "F", studentNumber: "F1" },
        now + 200,
        { idGenerator: idGen },
      );
      session = f1.session;
      expect(session.lastNextAlert).toMatchObject({
        seq: 2,
        sex: "F",
        entryId: f1.entry.id,
        studentNumber: "F1",
      });

      // M1 enters => M head becomes M2 => seq 3
      session = applyEntryAction(
        session,
        { entryId: m1.entry.id, action: "enter" },
        now + 300,
      ).session;
      expect(session.lastNextAlert).toMatchObject({
        seq: 3,
        sex: "M",
        entryId: m2.entry.id,
        studentNumber: "M2",
      });

      // M1 returns => M2 still head => seq stays 3
      session = applyEntryAction(
        session,
        { entryId: m1.entry.id, action: "return" },
        now + 400,
      ).session;
      expect(session.lastNextAlert?.seq).toBe(3);

      // M2 enters => M queue empty (null) => NO new alert, seq stays 3
      session = applyEntryAction(
        session,
        { entryId: m2.entry.id, action: "enter" },
        now + 500,
      ).session;
      expect(session.nextBySex.M).toBeNull();
      expect(session.lastNextAlert?.seq).toBe(3);

      // Add M3 while M2 active => M head becomes M3 => seq 4
      const m3 = submitStudent(
        session,
        { sex: "M", studentNumber: "M3" },
        now + 600,
        { idGenerator: idGen },
      );
      session = m3.session;
      expect(session.lastNextAlert).toMatchObject({
        seq: 4,
        sex: "M",
        entryId: m3.entry.id,
      });

      // Add M4 & M5 (head stays M3) => seq stays 4
      const m4 = submitStudent(
        session,
        { sex: "M", studentNumber: "M4" },
        now + 700,
        { idGenerator: idGen },
      );
      const m5 = submitStudent(
        m4.session,
        { sex: "M", studentNumber: "M5" },
        now + 800,
        { idGenerator: idGen },
      );
      session = m5.session;
      expect(session.lastNextAlert?.seq).toBe(4);

      // Remove head M3 => M4 becomes head => seq 5
      session = applyEntryAction(
        session,
        { entryId: m3.entry.id, action: "remove" },
        now + 900,
      ).session;
      expect(session.lastNextAlert).toMatchObject({
        seq: 5,
        sex: "M",
        entryId: m4.entry.id,
      });

      // Reorder M5 to head => seq 6
      session = reorderQueuedEntry(
        session,
        { entryId: m5.entry.id, direction: "up" },
        now + 1000,
      );
      expect(session.lastNextAlert).toMatchObject({
        seq: 6,
        sex: "M",
        entryId: m5.entry.id,
      });

      // Reorder non-head (add M6 at tail then move M6 up to index 1 while M5 stays head) => seq stays 6
      const m6 = submitStudent(
        session,
        { sex: "M", studentNumber: "M6" },
        now + 1100,
        { idGenerator: idGen },
      );
      session = reorderQueuedEntry(
        m6.session,
        { entryId: m6.entry.id, targetIndex: 1 },
        now + 1200,
      );
      expect(session.nextBySex.M).toBe(m5.entry.id);
      expect(session.lastNextAlert?.seq).toBe(6);
    });

    it("increments seq twice deterministically (M then F) when both heads change simultaneously", () => {
      const entries = [
        {
          id: "e-m",
          sex: "M" as const,
          studentNumber: "M10",
          status: "queued" as const,
          submittedBy: "Staff",
          createdAt: 100,
          enteredAt: null,
          returnedAt: null,
          override: false,
        },
        {
          id: "e-f",
          sex: "F" as const,
          studentNumber: "F10",
          status: "queued" as const,
          submittedBy: "Staff",
          createdAt: 101,
          enteredAt: null,
          returnedAt: null,
          override: false,
        },
      ];

      expect(computeNextBySex(entries)).toEqual({ M: "e-m", F: "e-f" });

      const result = reconcileNextAndAlerts({
        prevNextBySex: { M: null, F: null },
        entries,
        prevAlertSeq: 10,
        prevLastNextAlert: null,
        triggeredAt: 500,
      });

      expect(result.nextBySex).toEqual({ M: "e-m", F: "e-f" });
      expect(result.alertSeq).toBe(12);
      expect(result.lastNextAlert).toEqual({
        seq: 12,
        sex: "F",
        entryId: "e-f",
        studentNumber: "F10",
        triggeredAt: 500,
      });
    });
  });

  describe("8. Clear Session", () => {
    it("wipes entries, resets alert display, preserves config/staff/alertSeq, and allows resubmission", () => {
      const idGen = makeSeqIdGen("clr");
      const now = BASE_START + 45 * MIN;
      let session = makeConfiguredSession(120);
      session = joinStaff(session, { label: "Staff 1" }, now, {
        idGenerator: idGen,
      }).session;
      session = submitStudent(
        session,
        { sex: "M", studentNumber: "M100" },
        now + 100,
        { idGenerator: idGen },
      ).session;
      const f1 = submitStudent(
        session,
        { sex: "F", studentNumber: "F200" },
        now + 200,
        { idGenerator: idGen },
      );
      session = applyEntryAction(
        f1.session,
        { entryId: f1.entry.id, action: "enter" },
        now + 300,
      ).session;

      expect(session.alertSeq).toBe(2);
      const prevVersion = session.version;

      const cleared = clearSession(session, now + 400);
      expect(cleared.entries).toEqual([]);
      expect(cleared.nextBySex).toEqual({ M: null, F: null });
      expect(cleared.lastNextAlert).toBeNull();
      expect(cleared.clearedSeq).toBe(1);
      expect(cleared.version).toBe(prevVersion + 1);
      expect(cleared.alertSeq).toBe(2); // monotonic preserved
      expect(cleared.examConfig).toEqual(session.examConfig);
      expect(cleared.staff).toEqual(session.staff);
      expect(cleared.id).toBe(session.id);
      expect(cleared.controllerKey).toBe(session.controllerKey);

      // Re-submitting previously active student succeeds and gets seq = 3
      const afterClear = submitStudent(
        cleared,
        { sex: "F", studentNumber: "F200" },
        now + 500,
        { idGenerator: idGen },
      );
      expect(afterClear.entry.studentNumber).toBe("F200");
      expect(afterClear.session.alertSeq).toBe(3);
      expect(afterClear.session.lastNextAlert?.seq).toBe(3);
    });
  });
});
