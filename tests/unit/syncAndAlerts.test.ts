import { describe, expect, it } from "vitest";
import {
  acknowledgeAlert,
  applyEntryAction,
  clearSession,
  createSession,
  submitStudent,
  toSessionSnapshot,
  updateExamConfig,
  type SessionSnapshot,
} from "@/lib/domain";
import {
  isSnapshotNewer,
  mergeUnchangedPollState,
} from "@/lib/client/useSessionSync";
import {
  evaluateAlertSnapshot,
  type AlertTrackerState,
} from "@/lib/client/useNextStudentAlert";
import { createSerialMutationQueue } from "@/lib/client/mutationQueue";

const MIN = 60_000;
const BASE_START = 1_700_000_000_000;

function makeAllowedSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  const session = updateExamConfig(
    createSession(BASE_START, { id: "sync-sess", controllerKey: "ctrl-1" }),
    { startTimeMs: BASE_START, durationMinutes: 120 },
    BASE_START,
  );
  return {
    ...toSessionSnapshot(session, BASE_START + 40 * MIN),
    ...overrides,
  };
}

describe("Client Sync & Alert Transitions", () => {
  describe("isSnapshotNewer", () => {
    it("treats any snapshot as newer when current is null", () => {
      const candidate = makeAllowedSnapshot({ version: 1, clearedSeq: 0 });
      expect(isSnapshotNewer(candidate, null)).toBe(true);
    });

    it("prioritizes clearedSeq over version in both directions", () => {
      const current = makeAllowedSnapshot({ version: 10, clearedSeq: 1 });
      const newerClearedLowerVersion = makeAllowedSnapshot({
        version: 2,
        clearedSeq: 2,
      });
      const olderClearedHigherVersion = makeAllowedSnapshot({
        version: 99,
        clearedSeq: 0,
      });

      expect(isSnapshotNewer(newerClearedLowerVersion, current)).toBe(true);
      expect(isSnapshotNewer(olderClearedHigherVersion, current)).toBe(false);
    });

    it("compares version strictly when clearedSeq is equal", () => {
      const current = makeAllowedSnapshot({ version: 5, clearedSeq: 1 });
      expect(
        isSnapshotNewer(
          makeAllowedSnapshot({ version: 6, clearedSeq: 1 }),
          current,
        ),
      ).toBe(true);
      expect(
        isSnapshotNewer(
          makeAllowedSnapshot({ version: 5, clearedSeq: 1 }),
          current,
        ),
      ).toBe(false);
      expect(
        isSnapshotNewer(
          makeAllowedSnapshot({ version: 4, clearedSeq: 1 }),
          current,
        ),
      ).toBe(false);
    });
  });

  describe("mergeUnchangedPollState", () => {
    it("returns null when current snapshot is null", () => {
      expect(
        mergeUnchangedPollState(null, {
          unchanged: true,
          version: 2,
          serverNowMs: BASE_START + 45 * MIN,
          effectiveNowMs: BASE_START + 45 * MIN,
          windowStatus: "ALLOWED",
        }),
      ).toBeNull();
    });

    it("merges clock and windowStatus when poll version matches current version", () => {
      const current = makeAllowedSnapshot({
        version: 4,
        windowStatus: "FIRST_30_MIN",
        serverNowMs: BASE_START + 29 * MIN,
        effectiveNowMs: BASE_START + 29 * MIN,
      });

      const merged = mergeUnchangedPollState(current, {
        unchanged: true,
        version: 4,
        serverNowMs: BASE_START + 31 * MIN,
        effectiveNowMs: BASE_START + 31 * MIN,
        windowStatus: "ALLOWED",
      });

      expect(merged).not.toBeNull();
      expect(merged?.windowStatus).toBe("ALLOWED");
      expect(merged?.serverNowMs).toBe(BASE_START + 31 * MIN);
      expect(merged?.effectiveNowMs).toBe(BASE_START + 31 * MIN);
      expect(merged?.version).toBe(4);
      expect(merged?.entries).toEqual(current.entries);
    });

    it("discards stale unchanged:true responses when version does not match current", () => {
      const newerFromBroadcast = makeAllowedSnapshot({
        version: 5,
        windowStatus: "ALLOWED",
        serverNowMs: BASE_START + 40 * MIN,
        effectiveNowMs: BASE_START + 40 * MIN,
      });

      const stalePollResult = mergeUnchangedPollState(newerFromBroadcast, {
        unchanged: true,
        version: 4,
        serverNowMs: BASE_START + 15 * MIN,
        effectiveNowMs: BASE_START + 15 * MIN,
        windowStatus: "FIRST_30_MIN",
      });
      expect(stalePollResult).toBeNull();

      const aheadPollResult = mergeUnchangedPollState(newerFromBroadcast, {
        unchanged: true,
        version: 6,
        serverNowMs: BASE_START + 41 * MIN,
        effectiveNowMs: BASE_START + 41 * MIN,
        windowStatus: "ALLOWED",
      });
      expect(aheadPollResult).toBeNull();
    });
  });

  describe("Alert & Clear Session Lifecycle", () => {
    it("preserves monotonic alertSeq across clearSession while resetting lastNextAlert and triggering post-clear alerts", () => {
      const allowedNow = BASE_START + 40 * MIN;
      let session = updateExamConfig(
        createSession(BASE_START, { id: "alert-sess", controllerKey: "ctrl" }),
        { startTimeMs: BASE_START, durationMinutes: 120 },
        BASE_START,
      );

      // Submit M1 -> alertSeq 1
      const sub1 = submitStudent(
        session,
        { sex: "M", studentNumber: "1001" },
        allowedNow,
      );
      session = sub1.session;
      expect(session.alertSeq).toBe(1);
      expect(session.lastNextAlert?.seq).toBe(1);
      expect(session.lastNextAlert?.studentNumber).toBe("1001");

      // Submit F1 -> alertSeq 2
      const sub2 = submitStudent(
        session,
        { sex: "F", studentNumber: "2001" },
        allowedNow + 1000,
      );
      session = sub2.session;
      expect(session.alertSeq).toBe(2);
      expect(session.lastNextAlert?.seq).toBe(2);

      // Clear session -> alertSeq stays 2, lastNextAlert is null, clearedSeq is 1
      const cleared = clearSession(session, allowedNow + 2000);
      expect(cleared.alertSeq).toBe(2);
      expect(cleared.lastNextAlert).toBeNull();
      expect(cleared.clearedSeq).toBe(1);
      expect(cleared.entries).toHaveLength(0);

      // Re-submitting previously active student succeeds & advances alertSeq to 3
      const postClearSub = submitStudent(
        cleared,
        { sex: "M", studentNumber: "1001" },
        allowedNow + 3000,
      );
      expect(postClearSub.session.alertSeq).toBe(3);
      expect(postClearSub.session.lastNextAlert?.seq).toBe(3);
      expect(postClearSub.session.lastNextAlert?.studentNumber).toBe("1001");

      // Trace client alert evaluation across initial -> submit -> clear -> post-clear submit
      let tracker: AlertTrackerState = { seenAlertSeq: 0, prevClearedSeq: null };

      const initialEval = evaluateAlertSnapshot(
        tracker,
        toSessionSnapshot(sub1.session, allowedNow),
        { isInitial: true, enabled: true },
      );
      expect(initialEval.type).toBe("reset");
      tracker = initialEval.nextTracker;

      const f1Eval = evaluateAlertSnapshot(
        tracker,
        toSessionSnapshot(sub2.session, allowedNow + 1000),
        { isInitial: false, enabled: true },
      );
      expect(f1Eval.type).toBe("trigger");
      if (f1Eval.type === "trigger") {
        expect(f1Eval.alert.studentNumber).toBe("2001");
        expect(f1Eval.alert.seq).toBe(2);
        expect(f1Eval.triggerCount).toBe(1);
      }
      tracker = f1Eval.nextTracker;

      const clearedEval = evaluateAlertSnapshot(
        tracker,
        toSessionSnapshot(cleared, allowedNow + 2000),
        { isInitial: false, enabled: true },
      );
      expect(clearedEval.type).toBe("reset");
      expect(clearedEval.nextTracker.seenAlertSeq).toBe(0);
      expect(clearedEval.nextTracker.highWaterAlertSeq).toBe(2);
      tracker = clearedEval.nextTracker;

      const postClearEval = evaluateAlertSnapshot(
        tracker,
        toSessionSnapshot(postClearSub.session, allowedNow + 3000),
        { isInitial: false, enabled: true },
      );
      expect(postClearEval.type).toBe("trigger");
      if (postClearEval.type === "trigger") {
        expect(postClearEval.alert.seq).toBe(3);
        expect(postClearEval.alert.studentNumber).toBe("1001");
        expect(postClearEval.triggerCount).toBe(1);
      }

      // Even if client missed the intermediate empty cleared snapshot, didClear + seq 3 still fires
      const directCatchupEval = evaluateAlertSnapshot(
        { seenAlertSeq: 2, prevClearedSeq: 0 },
        toSessionSnapshot(postClearSub.session, allowedNow + 3000),
        { isInitial: false, enabled: true },
      );
      expect(directCatchupEval.type).toBe("trigger");
      if (directCatchupEval.type === "trigger") {
        expect(directCatchupEval.triggerCount).toBe(1);
      }
    });

    it("computes triggerCount for batched seq jumps within a single poll interval (0 -> 2 and 1 -> 4)", () => {
      const snapSeq2 = makeAllowedSnapshot({
        clearedSeq: 0,
        lastNextAlert: {
          seq: 2,
          sex: "F",
          entryId: "e-2",
          studentNumber: "MAT-2",
          triggeredAt: BASE_START + 40 * MIN,
        },
      });

      const batchFromZero = evaluateAlertSnapshot(
        { seenAlertSeq: 0, prevClearedSeq: 0, highWaterAlertSeq: 0 },
        snapSeq2,
        { isInitial: false, enabled: true },
      );
      expect(batchFromZero.type).toBe("trigger");
      if (batchFromZero.type === "trigger") {
        expect(batchFromZero.triggerCount).toBe(2);
        expect(batchFromZero.alert.seq).toBe(2);
        expect(batchFromZero.nextTracker.seenAlertSeq).toBe(2);
        expect(batchFromZero.nextTracker.highWaterAlertSeq).toBe(2);
      }

      const snapSeq4 = makeAllowedSnapshot({
        clearedSeq: 0,
        lastNextAlert: {
          seq: 4,
          sex: "M",
          entryId: "e-4",
          studentNumber: "MAT-4",
          triggeredAt: BASE_START + 41 * MIN,
        },
      });
      const batchFromOne = evaluateAlertSnapshot(
        { seenAlertSeq: 1, prevClearedSeq: 0, highWaterAlertSeq: 1 },
        snapSeq4,
        { isInitial: false, enabled: true },
      );
      expect(batchFromOne.type).toBe("trigger");
      if (batchFromOne.type === "trigger") {
        expect(batchFromOne.triggerCount).toBe(3);
        expect(batchFromOne.nextTracker.highWaterAlertSeq).toBe(4);
      }
    });

    it("does not overcount post-clear alerts on connected clients (seq 2 -> clear -> seq 3 yields triggerCount 1)", () => {
      let tracker: AlertTrackerState = {
        seenAlertSeq: 0,
        prevClearedSeq: null,
        highWaterAlertSeq: 0,
      };

      const initial = evaluateAlertSnapshot(
        tracker,
        makeAllowedSnapshot({ clearedSeq: 0, lastNextAlert: null }),
        { isInitial: true, enabled: true },
      );
      tracker = initial.nextTracker;

      const batchPreClear = evaluateAlertSnapshot(
        tracker,
        makeAllowedSnapshot({
          clearedSeq: 0,
          lastNextAlert: {
            seq: 2,
            sex: "F",
            entryId: "e-2",
            studentNumber: "200",
            triggeredAt: BASE_START + 40 * MIN,
          },
        }),
        { isInitial: false, enabled: true },
      );
      expect(batchPreClear.type).toBe("trigger");
      if (batchPreClear.type === "trigger") {
        expect(batchPreClear.triggerCount).toBe(2);
      }
      tracker = batchPreClear.nextTracker;

      const clearStep = evaluateAlertSnapshot(
        tracker,
        makeAllowedSnapshot({ clearedSeq: 1, lastNextAlert: null }),
        { isInitial: false, enabled: true },
      );
      expect(clearStep.type).toBe("reset");
      expect(clearStep.nextTracker.seenAlertSeq).toBe(0);
      expect(clearStep.nextTracker.highWaterAlertSeq).toBe(2);
      tracker = clearStep.nextTracker;

      const postClearStep = evaluateAlertSnapshot(
        tracker,
        makeAllowedSnapshot({
          clearedSeq: 1,
          lastNextAlert: {
            seq: 3,
            sex: "M",
            entryId: "e-3",
            studentNumber: "300",
            triggeredAt: BASE_START + 42 * MIN,
          },
        }),
        { isInitial: false, enabled: true },
      );
      expect(postClearStep.type).toBe("trigger");
      if (postClearStep.type === "trigger") {
        expect(postClearStep.triggerCount).toBe(1);
        expect(postClearStep.nextTracker.highWaterAlertSeq).toBe(3);
      }
    });

    it("suppresses alerts while disabled (e.g. before staff join completes)", () => {
      const snap = makeAllowedSnapshot({
        lastNextAlert: {
          seq: 4,
          sex: "M",
          entryId: "e-4",
          studentNumber: "4004",
          triggeredAt: BASE_START + 40 * MIN,
        },
      });
      const res = evaluateAlertSnapshot(
        { seenAlertSeq: 0, prevClearedSeq: 0 },
        snap,
        { isInitial: false, enabled: false },
      );
      expect(res.type).toBe("reset");
      expect(res.nextTracker.seenAlertSeq).toBe(4);
    });

    it("triggers on consecutive return-to-ready transitions even for mid-turn joiners and after prior acknowledgment", () => {
      const allowedNow = BASE_START + 40 * MIN;
      let session = updateExamConfig(
        createSession(BASE_START, { id: "ret-alert-sess", controllerKey: "ctrl" }),
        { startTimeMs: BASE_START, durationMinutes: 120 },
        BASE_START,
      );

      const m1 = submitStudent(session, { sex: "M", studentNumber: "101" }, allowedNow);
      const m2 = submitStudent(m1.session, { sex: "M", studentNumber: "102" }, allowedNow + 100);
      const m3 = submitStudent(m2.session, { sex: "M", studentNumber: "103" }, allowedNow + 200);
      session = m3.session;

      // M1 enters -> M2 becomes next (seq 2), and someone acknowledges seq 2
      session = applyEntryAction(session, { entryId: m1.entry.id, action: "enter" }, allowedNow + 300).session;
      session = acknowledgeAlert(session, { actorKey: "controller", label: "Controller", seq: 2 }, allowedNow + 350);

      // Client joins mid-turn while M1 is in_bathroom and seq 2 is already acknowledged
      let midTurnTracker: AlertTrackerState = { seenAlertSeq: 0, prevClearedSeq: null };
      const midInitial = evaluateAlertSnapshot(
        midTurnTracker,
        toSessionSnapshot(session, allowedNow + 360),
        { isInitial: true, enabled: true },
      );
      expect(midInitial.type).toBe("reset");
      midTurnTracker = midInitial.nextTracker;

      // M1 returns -> M2 is now ready -> seq increments to 3 without acknowledgedBy -> triggers!
      session = applyEntryAction(session, { entryId: m1.entry.id, action: "return" }, allowedNow + 400).session;
      const return1Eval = evaluateAlertSnapshot(
        midTurnTracker,
        toSessionSnapshot(session, allowedNow + 400),
        { isInitial: false, enabled: true },
      );
      expect(return1Eval.type).toBe("trigger");
      if (return1Eval.type === "trigger") {
        expect(return1Eval.alert.seq).toBe(3);
        expect(return1Eval.alert.studentNumber).toBe("102");
        expect(return1Eval.alert.acknowledgedBy).toBeUndefined();
      }
      midTurnTracker = return1Eval.nextTracker;

      // M2 enters (seq 4), then returns -> M3 is now ready -> seq 5 -> triggers again!
      session = applyEntryAction(session, { entryId: m2.entry.id, action: "enter" }, allowedNow + 500).session;
      const enter2Eval = evaluateAlertSnapshot(
        midTurnTracker,
        toSessionSnapshot(session, allowedNow + 500),
        { isInitial: false, enabled: true },
      );
      expect(enter2Eval.type).toBe("trigger");
      midTurnTracker = enter2Eval.nextTracker;

      session = applyEntryAction(session, { entryId: m2.entry.id, action: "return" }, allowedNow + 600).session;
      const return2Eval = evaluateAlertSnapshot(
        midTurnTracker,
        toSessionSnapshot(session, allowedNow + 600),
        { isInitial: false, enabled: true },
      );
      expect(return2Eval.type).toBe("trigger");
      if (return2Eval.type === "trigger") {
        expect(return2Eval.alert.seq).toBe(5);
        expect(return2Eval.alert.studentNumber).toBe("103");
        expect(return2Eval.triggerCount).toBe(1);
      }
    });
  });

  describe("createSerialMutationQueue", () => {
    it("executes enqueued mutations strictly sequentially in FIFO order even when earlier tasks are slower or reject", async () => {
      const enqueue = createSerialMutationQueue();
      const events: string[] = [];

      const p1 = enqueue(async () => {
        events.push("start:1");
        await new Promise((r) => setTimeout(r, 25));
        events.push("end:1");
        return "one";
      });

      const p2 = enqueue(async () => {
        events.push("start:2");
        await new Promise((r) => setTimeout(r, 5));
        events.push("end:2");
        throw new Error("boom");
      });

      const p3 = enqueue(async () => {
        events.push("start:3");
        events.push("end:3");
        return "three";
      });

      await expect(p1).resolves.toBe("one");
      await expect(p2).rejects.toThrow("boom");
      await expect(p3).resolves.toBe("three");
      expect(events).toEqual([
        "start:1",
        "end:1",
        "start:2",
        "end:2",
        "start:3",
        "end:3",
      ]);
    });
  });
});
