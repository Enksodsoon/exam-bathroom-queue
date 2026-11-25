import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DomainError,
  MAX_VALID_DATE_MS,
  applyEntryAction,
  clearSession,
  createSession,
  evaluateExamWindow,
  getExamWindowBounds,
  joinStaff,
  reconcileNextAndAlerts,
  submitStudent,
  toSessionSnapshot,
  updateExamConfig,
  type ExamSession,
  type SessionSnapshot,
} from "@/lib/domain";
import {
  FileSessionStore,
  StorageError,
  UpstashRedisSessionStore,
  parseStoredSession,
  type RedisLike,
} from "@/lib/storage";
import {
  ApiClientError,
  createSession as apiCreateSession,
  getSession as apiGetSession,
} from "@/lib/client/api";
import { evaluateAlertSnapshot } from "@/lib/client/useNextStudentAlert";
import {
  isValidBroadcastSnapshot,
  mergeUnchangedPollState,
} from "@/lib/client/useSessionSync";

const MIN = 60_000;
const BASE_START = 1_700_000_000_000;

function makeAllowedSession(): ExamSession {
  const s0 = createSession(BASE_START, {
    id: "adv-sess",
    controllerKey: "ctrl-adv",
  });
  return updateExamConfig(
    s0,
    { startTimeMs: BASE_START, durationMinutes: 120 },
    BASE_START,
  );
}

function makeAllowedSnapshot(
  overrides?: Partial<SessionSnapshot>,
): SessionSnapshot {
  return {
    ...toSessionSnapshot(makeAllowedSession(), BASE_START + 40 * MIN),
    ...overrides,
  };
}

describe("Tier 5 Adversarial Unit Tests", () => {
  describe("Domain Adversarial Paths", () => {
    it("handles unknown staffId fallback, staffId trimming, and submittedBy 40-char truncation", () => {
      const allowedNow = BASE_START + 40 * MIN;
      let session = makeAllowedSession();
      const joined = joinStaff(session, { label: "Wing B Proctor" }, allowedNow, {
        idGenerator: () => "st-trim-1",
      });
      session = joined.session;

      // Whitespace-padded staffId still matches joined staff member (Bug 7)
      const trimmedMatch = submitStudent(
        session,
        {
          sex: "M",
          studentNumber: "S-101",
          staffId: "  st-trim-1  ",
          submittedBy: "Ignored Fallback",
        },
        allowedNow + 500,
        { idGenerator: () => "e-1" },
      );
      expect(trimmedMatch.entry.submittedBy).toBe("Wing B Proctor");
      expect(trimmedMatch.session.staff[0].lastSeenAt).toBe(allowedNow + 500);

      // Unknown staffId falls back to truncated submittedBy (<= 40 chars)
      const longLabel = "X".repeat(65);
      const unknownWithLabel = submitStudent(
        trimmedMatch.session,
        {
          sex: "F",
          studentNumber: "S-102",
          staffId: "unknown-staff-id",
          submittedBy: `  ${longLabel}  `,
        },
        allowedNow + 1000,
        { idGenerator: () => "e-2" },
      );
      expect(unknownWithLabel.entry.submittedBy).toBe("X".repeat(40));

      // Unknown staffId without submittedBy falls back to Staff or Controller (when override)
      const unknownNoLabel = submitStudent(
        unknownWithLabel.session,
        {
          sex: "M",
          studentNumber: "S-103",
          staffId: "missing-id",
          submittedBy: "   ",
        },
        allowedNow + 1500,
        { idGenerator: () => "e-3" },
      );
      expect(unknownNoLabel.entry.submittedBy).toBe("Staff");

      const unknownOverride = submitStudent(
        unknownNoLabel.session,
        {
          sex: "F",
          studentNumber: "S-104",
          staffId: "missing-id",
          override: true,
        },
        allowedNow + 2000,
        { idGenerator: () => "e-4" },
      );
      expect(unknownOverride.entry.submittedBy).toBe("Controller");

      // Omitted staffId also truncates submittedBy to 40 chars
      const omittedStaffId = submitStudent(
        unknownOverride.session,
        {
          sex: "M",
          studentNumber: "S-105",
          submittedBy: "Y".repeat(55),
        },
        allowedNow + 2500,
        { idGenerator: () => "e-5" },
      );
      expect(omittedStaffId.entry.submittedBy).toBe("Y".repeat(40));
    });

    it("rejects invalid applyEntryAction inputs and state transitions (removing returned/removed, entering removed)", () => {
      const now = BASE_START + 40 * MIN;
      let session = makeAllowedSession();
      const sub = submitStudent(
        session,
        { sex: "M", studentNumber: "ST-1" },
        now,
        { idGenerator: () => "e-act-1" },
      );
      session = sub.session;

      expect(() =>
        applyEntryAction(
          session,
          { entryId: "e-act-1", action: "bogus" as "enter" },
          now,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        applyEntryAction(session, { entryId: "   ", action: "enter" }, now),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      // Remove queued entry, then try removing again or entering removed -> INVALID_STATE
      const removed = applyEntryAction(
        session,
        { entryId: "e-act-1", action: "remove" },
        now + 100,
      );
      expect(() =>
        applyEntryAction(
          removed.session,
          { entryId: "e-act-1", action: "remove" },
          now + 200,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(() =>
        applyEntryAction(
          removed.session,
          { entryId: "e-act-1", action: "enter" },
          now + 200,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));

      // Return entry, then removing returned entry -> INVALID_STATE
      const sub2 = submitStudent(
        removed.session,
        { sex: "F", studentNumber: "ST-2" },
        now + 300,
        { idGenerator: () => "e-act-2" },
      );
      const entered = applyEntryAction(
        sub2.session,
        { entryId: "e-act-2", action: "enter" },
        now + 400,
      );
      const returned = applyEntryAction(
        entered.session,
        { entryId: "e-act-2", action: "return" },
        now + 500,
      );
      expect(() =>
        applyEntryAction(
          returned.session,
          { entryId: "e-act-2", action: "remove" },
          now + 600,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
    });

    it("rejects non-finite triggeredAt in reconcileNextAndAlerts", () => {
      for (const badTs of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        expect(() =>
          reconcileNextAndAlerts({
            prevNextBySex: { M: null, F: null },
            entries: [],
            prevAlertSeq: 0,
            prevLastNextAlert: null,
            triggeredAt: badTs,
          }),
        ).toThrowError(DomainError);
      }
    });

    it("enforces JS Date range (±8.64e15) and validates clockOffsetMs inside updateExamConfig (Bug 4)", () => {
      const s0 = createSession(BASE_START, { id: "date-s", controllerKey: "k" });

      expect(() =>
        getExamWindowBounds({ startTimeMs: 1e20, durationMinutes: 120 }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        getExamWindowBounds({ startTimeMs: -1e20, durationMinutes: 120 }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        getExamWindowBounds({
          startTimeMs: MAX_VALID_DATE_MS,
          durationMinutes: 1,
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      // updateExamConfig must reject clockOffsetMs that pushes effectiveNowMs outside ±8.64e15 BEFORE returning
      expect(() =>
        updateExamConfig(
          s0,
          {
            startTimeMs: BASE_START,
            durationMinutes: 120,
            clockOffsetMs: 1e20,
          },
          BASE_START,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        updateExamConfig(
          s0,
          {
            startTimeMs: BASE_START,
            durationMinutes: 120,
            clockOffsetMs: MAX_VALID_DATE_MS,
          },
          BASE_START,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(() =>
        evaluateExamWindow(null, MAX_VALID_DATE_MS + 1),
      ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

      // Valid Date boundary still succeeds
      const boundary = updateExamConfig(
        s0,
        { startTimeMs: -MAX_VALID_DATE_MS, durationMinutes: 1 },
        -MAX_VALID_DATE_MS + 60_000,
      );
      expect(boundary.examConfig?.startTimeMs).toBe(-MAX_VALID_DATE_MS);
    });

    it("safely handles prototype-pollution strings and Unicode/emoji in staff labels & student numbers", () => {
      const now = BASE_START + 40 * MIN;
      let session = makeAllowedSession();
      const protoLabels = ["__proto__", "constructor", "prototype", "🧑‍🏫 Hall α"];

      for (let i = 0; i < protoLabels.length; i += 1) {
        const label = protoLabels[i];
        const joined = joinStaff(session, { label }, now + i, {
          idGenerator: () => `st-u-${i}`,
        });
        session = joined.session;
        expect(joined.staff.label).toBe(label);

        const submitted = submitStudent(
          session,
          {
            sex: i % 2 === 0 ? "M" : "F",
            studentNumber: `${label}-${i}`,
            staffId: joined.staff.id,
          },
          now + 100 + i,
          { idGenerator: () => `e-u-${i}` },
        );
        session = submitted.session;
        expect(submitted.entry.studentNumber).toBe(`${label}-${i}`);
        expect(submitted.entry.submittedBy).toBe(label);
      }

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty("Hall α");
    });
  });

  describe("Storage Adversarial Paths", () => {
    let tempDir = "";

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "examq-t5-unit-"));
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = "";
      }
    });

    it("rejects corrupt stored sessions in parseStoredSession (Bug 5)", () => {
      const valid = createSession(BASE_START, {
        id: "valid-id",
        controllerKey: "ctrl",
      });

      expect(() =>
        parseStoredSession({
          ...valid,
          examConfig: { startTimeMs: BASE_START, durationMinutes: 0 },
        }),
      ).toThrowError(expect.objectContaining({ code: "CORRUPT_DATA" }));

      expect(() =>
        parseStoredSession({
          ...valid,
          examConfig: { startTimeMs: 1e20, durationMinutes: 120 },
        }),
      ).toThrowError(expect.objectContaining({ code: "CORRUPT_DATA" }));

      expect(() =>
        parseStoredSession({
          ...valid,
          lastNextAlert: {},
        }),
      ).toThrowError(expect.objectContaining({ code: "CORRUPT_DATA" }));

      expect(() =>
        parseStoredSession({
          ...valid,
          entries: [null],
        }),
      ).toThrowError(expect.objectContaining({ code: "CORRUPT_DATA" }));

      expect(() =>
        parseStoredSession({
          ...valid,
          staff: [{}],
        }),
      ).toThrowError(expect.objectContaining({ code: "CORRUPT_DATA" }));
    });

    it("handles corrupt/empty files, EXDEV/ENOTSUP link fallback, invalid IDs, and mutex non-poisoning in FileSessionStore", async () => {
      const store = new FileSessionStore(tempDir);

      // Invalid session IDs
      for (const badId of ["../escape", "", "a/b", "x".repeat(65)]) {
        const fake = createSession(1000, { id: "ok", controllerKey: "k" });
        await expect(
          store.create({ ...fake, id: badId }),
        ).rejects.toMatchObject({ code: "INVALID_SESSION_ID" });
        await expect(
          store.mutate(badId, (c) => ({ session: c, result: null })),
        ).rejects.toMatchObject({ code: "INVALID_SESSION_ID" });
      }

      // Corrupt JSON and 0-byte file -> CORRUPT_DATA
      await fs.writeFile(path.join(tempDir, "bad-json.json"), "{broken", "utf8");
      await fs.writeFile(path.join(tempDir, "empty-file.json"), "", "utf8");
      await expect(store.get("bad-json")).rejects.toMatchObject({
        code: "CORRUPT_DATA",
      });
      await expect(store.get("empty-file")).rejects.toMatchObject({
        code: "CORRUPT_DATA",
      });
      await expect(
        store.mutate("bad-json", (c) => ({ session: c, result: null })),
      ).rejects.toMatchObject({ code: "CORRUPT_DATA" });

      // EXDEV / ENOTSUP fallback to rename in create()
      const linkSpy = vi
        .spyOn(fs, "link")
        .mockRejectedValueOnce(
          Object.assign(new Error("EXDEV"), { code: "EXDEV" }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" }),
        );

      const sExdev = createSession(1000, {
        id: "exdev-sess",
        controllerKey: "ctrl",
      });
      await expect(store.create(sExdev)).resolves.toMatchObject({
        id: "exdev-sess",
      });
      const sEnotsup = createSession(1000, {
        id: "enotsup-sess",
        controllerKey: "ctrl",
      });
      await expect(store.create(sEnotsup)).resolves.toMatchObject({
        id: "enotsup-sess",
      });
      expect(linkSpy).toHaveBeenCalledTimes(2);
      linkSpy.mockRestore();

      // Failed mutate (DomainError + EPERM rename) does not poison withSessionLock mutex chain
      await expect(
        store.mutate("exdev-sess", (c) => {
          submitStudent(c, { sex: "M", studentNumber: "100" }, 2000);
          return { session: c, result: null };
        }),
      ).rejects.toMatchObject({ code: "OUTSIDE_TIME_WINDOW" });

      const renameSpy = vi
        .spyOn(fs, "rename")
        .mockRejectedValue(Object.assign(new Error("EPERM"), { code: "EPERM" }));
      await expect(
        store.mutate("exdev-sess", (c) => ({
          session: { ...c, version: c.version + 1 },
          result: null,
        })),
      ).rejects.toThrow("EPERM");
      renameSpy.mockRestore();

      // Subsequent mutate & get succeed cleanly on the same session lock key
      const recovered = await store.mutate("exdev-sess", (c) => ({
        session: { ...c, version: c.version + 1 },
        result: c.version + 1,
      }));
      expect(recovered.result).toBe(2);
      const after = await store.get("exdev-sess");
      expect(after?.version).toBe(2);
    });

    it("handles corrupt JSON, unexpected CAS codes, and Redis errors in UpstashRedisSessionStore", async () => {
      const records = new Map<string, string>();
      let forceGetError: Error | null = null;
      let forceEvalCode: number | null = null;

      const redis: RedisLike = {
        async get<TData = unknown>(key: string): Promise<TData | null> {
          if (forceGetError) throw forceGetError;
          return (records.get(key) ?? null) as unknown as TData | null;
        },
        async set<TData = unknown>(
          key: string,
          value: TData,
        ): Promise<"OK" | TData | null> {
          records.set(
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          );
          return "OK";
        },
        async eval<TArgs extends unknown[], TData = unknown>(
          ...args: [string, string[], TArgs]
        ): Promise<TData> {
          void args;
          if (forceEvalCode !== null) {
            return forceEvalCode as unknown as TData;
          }
          return 1 as unknown as TData;
        },
      };

      const store = new UpstashRedisSessionStore({ redis });
      records.set("examq:session:corrupt-r", "{not-json");
      await expect(store.get("corrupt-r")).rejects.toThrow(StorageError);
      await expect(store.get("corrupt-r")).rejects.toMatchObject({
        code: "CORRUPT_DATA",
      });

      const s = createSession(1000, { id: "cas-r", controllerKey: "ctrl" });
      await store.create(s);
      forceEvalCode = 99;
      await expect(
        store.mutate("cas-r", (curr) => ({ session: curr, result: null })),
      ).rejects.toMatchObject({ code: "CORRUPT_DATA" });

      forceGetError = new Error("Redis network timeout");
      await expect(store.get("cas-r")).rejects.toThrow("Redis network timeout");
    });
  });

  describe("Client Alert, Broadcast Validation, Sync & API Client Adversarial Paths", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fires triggerCount=1 (not K+1) for brand-new post-clear late-joiner and tracks subsequent jumps accurately (Bug 1)", () => {
      // Simulate session that had 5 pre-clear alerts (alertSeq=5), then cleared (clearedSeq=1, lastNextAlert=null)
      let session = makeAllowedSession();
      const now = BASE_START + 40 * MIN;
      for (let i = 1; i <= 5; i += 1) {
        const sub = submitStudent(
          session,
          { sex: "M", studentNumber: `PRE-${i}` },
          now + i,
          { idGenerator: () => `pre-e-${i}` },
        );
        session = applyEntryAction(
          sub.session,
          { entryId: sub.entry.id, action: "enter" },
          now + 100 + i,
        ).session;
        session = applyEntryAction(
          session,
          { entryId: sub.entry.id, action: "return" },
          now + 200 + i,
        ).session;
      }
      expect(session.alertSeq).toBe(5);
      const cleared = clearSession(session, now + 500);
      expect(cleared.clearedSeq).toBe(1);
      expect(cleared.lastNextAlert).toBeNull();

      // Brand-new client joins after clear while lastNextAlert === null
      const initialEval = evaluateAlertSnapshot(
        { seenAlertSeq: 0, prevClearedSeq: null, highWaterAlertSeq: 0 },
        toSessionSnapshot(cleared, now + 600),
        { isInitial: true, enabled: true },
      );
      expect(initialEval.type).toBe("reset");
      expect(initialEval.nextTracker).toEqual({
        seenAlertSeq: 0,
        prevClearedSeq: 1,
        highWaterAlertSeq: 0,
      });

      // 1 post-clear student submitted -> alertSeq becomes 6
      const post1 = submitStudent(
        cleared,
        { sex: "M", studentNumber: "POST-1" },
        now + 700,
        { idGenerator: () => "post-e-1" },
      );
      const firstPostEval = evaluateAlertSnapshot(
        initialEval.nextTracker,
        toSessionSnapshot(post1.session, now + 700),
        { isInitial: false, enabled: true },
      );
      expect(firstPostEval.type).toBe("trigger");
      if (firstPostEval.type === "trigger") {
        expect(firstPostEval.triggerCount).toBe(1);
        expect(firstPostEval.alert.seq).toBe(6);
        expect(firstPostEval.nextTracker.highWaterAlertSeq).toBe(6);
      }

      // Subsequent batched jump 6 -> 8 on that same client still counts accurately (8 - 6 = 2)
      const jumpSnap = makeAllowedSnapshot({
        clearedSeq: 1,
        lastNextAlert: {
          seq: 8,
          sex: "F",
          entryId: "post-e-3",
          studentNumber: "POST-3",
          triggeredAt: now + 900,
        },
      });
      const secondEval = evaluateAlertSnapshot(
        firstPostEval.nextTracker,
        jumpSnap,
        { isInitial: false, enabled: true },
      );
      expect(secondEval.type).toBe("trigger");
      if (secondEval.type === "trigger") {
        expect(secondEval.triggerCount).toBe(2);
      }
    });

    it("rejects malformed BroadcastChannel snapshots via isValidBroadcastSnapshot (Bug 3)", () => {
      const valid = makeAllowedSnapshot();
      expect(isValidBroadcastSnapshot(valid)).toBe(true);

      const invalidPayloads: unknown[] = [
        null,
        undefined,
        "string",
        [],
        { id: valid.id, version: 999, clearedSeq: 0 },
        { ...valid, windowStatus: "BOGUS_STATUS" },
        { ...valid, version: 0 },
        { ...valid, version: 1.5 },
        { ...valid, clearedSeq: -1 },
        { ...valid, serverNowMs: Number.NaN },
        { ...valid, effectiveNowMs: Number.POSITIVE_INFINITY },
        { ...valid, entries: "not-array" },
        { ...valid, entries: [null] },
        { ...valid, staff: [{}] },
        { ...valid, nextBySex: null },
        { ...valid, nextBySex: { M: 123, F: null } },
        { ...valid, examConfig: { startTimeMs: BASE_START, durationMinutes: 0 } },
        { ...valid, lastNextAlert: {} },
      ];

      for (const payload of invalidPayloads) {
        expect(isValidBroadcastSnapshot(payload)).toBe(false);
      }
    });

    it("returns null from mergeUnchangedPollState when server version is ahead (triggering retryForceFull)", () => {
      const current = makeAllowedSnapshot({ version: 3 });
      expect(
        mergeUnchangedPollState(current, {
          unchanged: true,
          version: 7,
          serverNowMs: BASE_START + 45 * MIN,
          effectiveNowMs: BASE_START + 45 * MIN,
          windowStatus: "ALLOWED",
        }),
      ).toBeNull();
    });

    it("throws ApiClientError(INVALID_RESPONSE) when 200 OK returns non-JSON or literal null (Bug 6)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("<html>not json</html>", { status: 200 })),
      );

      await expect(apiCreateSession()).rejects.toThrow(ApiClientError);
      await expect(apiCreateSession()).rejects.toMatchObject({
        status: 200,
        code: "INVALID_RESPONSE",
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("null", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      );
      await expect(apiGetSession("sess-1")).rejects.toMatchObject({
        status: 200,
        code: "INVALID_RESPONSE",
      });
    });
  });
});
