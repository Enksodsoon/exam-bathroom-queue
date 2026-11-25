import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as createSessionRoute } from "@/app/api/sessions/route";
import { GET as getSessionRoute } from "@/app/api/sessions/[id]/route";
import { POST as clearSessionRoute } from "@/app/api/sessions/[id]/clear/route";
import { PATCH as updateConfigRoute } from "@/app/api/sessions/[id]/config/route";
import { POST as submitEntryRoute } from "@/app/api/sessions/[id]/entries/route";
import { POST as entryActionRoute } from "@/app/api/sessions/[id]/entries/[entryId]/action/route";
import { POST as joinSessionRoute } from "@/app/api/sessions/[id]/join/route";
import { POST as reorderRoute } from "@/app/api/sessions/[id]/reorder/route";
import { createSession, submitStudent, type SessionSnapshot } from "@/lib/domain";
import {
  FileSessionStore,
  getSessionStore,
  getStorageHealth,
  resetSessionStoreForTests,
  SESSION_TTL_SECONDS,
  StorageError,
  UpstashRedisSessionStore,
  type RedisLike,
} from "@/lib/storage";

const ENV_KEYS = [
  "EXAMQ_DATA_DIR",
  "VERCEL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function makeRequest(
  urlPath: string,
  options?: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  },
): NextRequest {
  const headers = new Headers(options?.headers);
  let body: string | undefined;

  if (options?.rawBody !== undefined) {
    body = options.rawBody;
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  } else if (options?.body !== undefined) {
    body = JSON.stringify(options.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: options?.method ?? "GET",
    headers,
    body,
  });
}

async function createTestSession() {
  const res = await createSessionRoute(
    makeRequest("/api/sessions", { method: "POST", body: {} }),
  );
  expect(res.status).toBe(201);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return (await res.json()) as {
    sessionId: string;
    controllerKey: string;
    joinUrl: string;
    controllerUrl: string;
    snapshot: SessionSnapshot;
  };
}

describe("M2 Storage & REST API Integration", () => {
  let tempDir = "";
  let savedEnv: EnvSnapshot;

  beforeEach(async () => {
    savedEnv = {
      EXAMQ_DATA_DIR: process.env.EXAMQ_DATA_DIR,
      VERCEL: process.env.VERCEL,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      KV_REST_API_URL: process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    };
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "examq-m2-int-"));
    process.env.EXAMQ_DATA_DIR = tempDir;
    resetSessionStoreForTests();
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetSessionStoreForTests();
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  describe("Health & Storage Factory", () => {
    it("returns 200 file storage health locally with Cache-Control: no-store", async () => {
      const res = await getHealth();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      await expect(res.json()).resolves.toEqual({
        ok: true,
        storage: "file",
      });
    });

    it("returns 500 when VERCEL=1 without Redis credentials", async () => {
      process.env.VERCEL = "1";
      const healthRes = await getHealth();
      expect(healthRes.status).toBe(500);
      expect(healthRes.headers.get("cache-control")).toBe("no-store");
      const healthBody = (await healthRes.json()) as {
        ok: boolean;
        storage: string;
        error?: string;
      };
      expect(healthBody.ok).toBe(false);
      expect(healthBody.storage).toBe("upstash-redis");
      expect(healthBody.error).toContain("VERCEL=1");

      const createRes = await createSessionRoute(
        makeRequest("/api/sessions", { method: "POST", body: {} }),
      );
      expect(createRes.status).toBe(500);
      expect(createRes.headers.get("cache-control")).toBe("no-store");
      await expect(createRes.json()).resolves.toMatchObject({
        code: "STORAGE_MISCONFIGURED",
      });
    });

    it("returns 500 on partial Redis configuration", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
      const healthRes = await getHealth();
      expect(healthRes.status).toBe(500);
      expect(healthRes.headers.get("cache-control")).toBe("no-store");
      const body = (await healthRes.json()) as {
        ok: boolean;
        storage: string;
        error?: string;
      };
      expect(body.ok).toBe(false);
      expect(body.storage).toBe("upstash-redis");
      expect(() => getSessionStore()).toThrowError(StorageError);
    });

    it("selects upstash-redis when UPSTASH_REDIS_REST_* or KV_REST_API_* are set", () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "token-1";
      expect(getStorageHealth()).toEqual({
        ok: true,
        storage: "upstash-redis",
      });
      expect(getSessionStore().backendName).toBe("upstash-redis");

      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.KV_REST_API_URL = "https://kv.example.io";
      process.env.KV_REST_API_TOKEN = "kv-token";
      expect(getStorageHealth()).toEqual({
        ok: true,
        storage: "upstash-redis",
      });
      expect(getSessionStore().backendName).toBe("upstash-redis");
    });

    it("switches FileSessionStore directory cleanly when EXAMQ_DATA_DIR changes", async () => {
      const first = await createTestSession();
      const secondDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "examq-m2-dir2-"),
      );
      try {
        process.env.EXAMQ_DATA_DIR = secondDir;
        const missingRes = await getSessionRoute(
          makeRequest(`/api/sessions/${first.sessionId}`),
          { params: Promise.resolve({ id: first.sessionId }) },
        );
        expect(missingRes.status).toBe(404);
      } finally {
        await fs.rm(secondDir, { recursive: true, force: true });
      }
    });
  });

  describe("FileSessionStore Guarantees", () => {
    it("enforces unique creation, valid IDs, missing gets, and unmodified state on DomainError", async () => {
      const store = new FileSessionStore(tempDir);
      const session = createSession(1_000, {
        id: "safe_session-1",
        controllerKey: "ctrl-secret",
      });
      await store.create(session);

      await expect(store.create(session)).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
      });
      await expect(store.get("missing-id")).resolves.toBeNull();
      await expect(store.get("../escape")).rejects.toMatchObject({
        code: "INVALID_SESSION_ID",
      });
      await expect(store.get("a/b")).rejects.toMatchObject({
        code: "INVALID_SESSION_ID",
      });
      await expect(store.get("x".repeat(65))).rejects.toMatchObject({
        code: "INVALID_SESSION_ID",
      });

      await expect(
        store.mutate("safe_session-1", (current) => {
          const res = submitStudent(
            current,
            { sex: "M", studentNumber: "S100" },
            2_000,
          );
          return { session: res.session, result: res.entry };
        }),
      ).rejects.toMatchObject({
        code: "OUTSIDE_TIME_WINDOW",
      });

      const persisted = await store.get("safe_session-1");
      expect(persisted?.version).toBe(1);
      expect(persisted?.entries).toHaveLength(0);
    });

    it("serializes 10 concurrent mutates without lost updates", async () => {
      const storeA = new FileSessionStore(tempDir);
      const storeB = new FileSessionStore(tempDir);
      const initial = createSession(1_000, {
        id: "concurrent-file",
        controllerKey: "ctrl-1",
      });
      await storeA.create(initial);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, idx) => {
          const targetStore = idx % 2 === 0 ? storeA : storeB;
          return targetStore.mutate("concurrent-file", (current) => ({
            session: {
              ...current,
              version: current.version + 1,
            },
            result: current.version + 1,
          }));
        }),
      );

      expect(results.map((r) => r.result).sort((a, b) => a - b)).toEqual([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
      const finalSession = await storeA.get("concurrent-file");
      expect(finalSession?.version).toBe(11);
    });
  });

  describe("UpstashRedisSessionStore Mocked Lua CAS", () => {
    function createMockRedis(options?: {
      autoDeserialize?: boolean;
      conflictsBeforeSuccess?: number;
      corruptOnEval?: boolean;
      missingOnEval?: boolean;
    }): {
      redis: RedisLike;
      records: Map<string, { value: string; ex: number }>;
    } {
      const records = new Map<string, { value: string; ex: number }>();
      let remainingConflicts = options?.conflictsBeforeSuccess ?? 0;

      const redis: RedisLike = {
        async get<TData = unknown>(key: string): Promise<TData | null> {
          const entry = records.get(key);
          if (!entry) return null;
          if (options?.autoDeserialize) {
            return JSON.parse(entry.value) as TData;
          }
          return entry.value as unknown as TData;
        },
        async set<TData = unknown>(
          key: string,
          value: TData,
          opts?: { ex: number } | { ex: number; nx: true },
        ): Promise<"OK" | TData | null> {
          const serialized =
            typeof value === "string" ? value : JSON.stringify(value);
          if (opts && "nx" in opts && opts.nx && records.has(key)) {
            return null;
          }
          records.set(key, {
            value: serialized,
            ex: opts?.ex ?? 0,
          });
          return "OK";
        },
        async eval<TArgs extends unknown[], TData = unknown>(
          _script: string,
          keys: string[],
          args: TArgs,
        ): Promise<TData> {
          if (options?.missingOnEval) {
            return -1 as unknown as TData;
          }
          if (options?.corruptOnEval) {
            return -2 as unknown as TData;
          }
          const key = keys[0];
          const entry = records.get(key);
          if (!entry) {
            return -1 as unknown as TData;
          }
          if (remainingConflicts > 0) {
            remainingConflicts -= 1;
            const parsed = JSON.parse(entry.value) as { version: number };
            parsed.version += 1;
            records.set(key, {
              value: JSON.stringify(parsed),
              ex: entry.ex,
            });
            return 0 as unknown as TData;
          }
          const expectedVersion = Number(args[0]);
          const nextValue = String(args[1]);
          const ttl = Number(args[2]);
          const parsed = JSON.parse(entry.value) as { version: number };
          if (parsed.version !== expectedVersion) {
            return 0 as unknown as TData;
          }
          records.set(key, { value: nextValue, ex: ttl });
          return 1 as unknown as TData;
        },
      };

      return { redis, records };
    }

    it("handles NX create with TTL, string & object get, and CAS retry convergence", async () => {
      const { redis, records } = createMockRedis({
        autoDeserialize: true,
        conflictsBeforeSuccess: 3,
      });
      const store = new UpstashRedisSessionStore({ redis, maxRetries: 6 });
      const session = createSession(5_000, {
        id: "redis-s1",
        controllerKey: "ctrl-redis",
      });

      await store.create(session);
      expect(records.get("examq:session:redis-s1")?.ex).toBe(
        SESSION_TTL_SECONDS,
      );
      await expect(store.create(session)).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
      });

      const fetched = await store.get("redis-s1");
      expect(fetched?.id).toBe("redis-s1");

      const mutated = await store.mutate("redis-s1", (current) => ({
        session: { ...current, version: current.version + 1 },
        result: current.version + 1,
      }));
      // 3 simulated conflicts bumped version 1->4 before our retry succeeded at 4->5
      expect(mutated.result).toBe(5);
      expect(mutated.session.version).toBe(5);
    });

    it("parses raw JSON strings and throws CONFLICT / NOT_FOUND / CORRUPT_DATA cleanly", async () => {
      const conflictMock = createMockRedis({
        autoDeserialize: false,
        conflictsBeforeSuccess: 10,
      });
      const conflictStore = new UpstashRedisSessionStore({
        redis: conflictMock.redis,
        maxRetries: 3,
      });
      const s = createSession(1_000, {
        id: "redis-conflict",
        controllerKey: "ctrl",
      });
      await conflictStore.create(s);
      await expect(
        conflictStore.mutate("redis-conflict", (curr) => ({
          session: { ...curr, version: curr.version + 1 },
          result: null,
        })),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const missingMock = createMockRedis({ missingOnEval: true });
      const missingStore = new UpstashRedisSessionStore({
        redis: missingMock.redis,
      });
      await missingStore.create(s);
      await expect(
        missingStore.mutate("redis-conflict", (curr) => ({
          session: curr,
          result: null,
        })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const corruptMock = createMockRedis({ corruptOnEval: true });
      const corruptStore = new UpstashRedisSessionStore({
        redis: corruptMock.redis,
      });
      await corruptStore.create(s);
      await expect(
        corruptStore.mutate("redis-conflict", (curr) => ({
          session: curr,
          result: null,
        })),
      ).rejects.toMatchObject({ code: "CORRUPT_DATA" });
    });

    it("converges 10 concurrent Promise.all writers against shared stateful Redis CAS with zero CONFLICT errors", async () => {
      const records = new Map<string, { value: string; ex: number }>();
      let evalConflictCount = 0;

      const statefulRedis: RedisLike = {
        async get<TData = unknown>(key: string): Promise<TData | null> {
          await Promise.resolve();
          const entry = records.get(key);
          return entry ? (entry.value as unknown as TData) : null;
        },
        async set<TData = unknown>(
          key: string,
          value: TData,
          opts?: { ex: number } | { ex: number; nx: true },
        ): Promise<"OK" | TData | null> {
          const serialized =
            typeof value === "string" ? value : JSON.stringify(value);
          if (opts && "nx" in opts && opts.nx && records.has(key)) {
            return null;
          }
          records.set(key, { value: serialized, ex: opts?.ex ?? 0 });
          return "OK";
        },
        async eval<TArgs extends unknown[], TData = unknown>(
          _script: string,
          keys: string[],
          args: TArgs,
        ): Promise<TData> {
          await Promise.resolve();
          const key = keys[0];
          const entry = records.get(key);
          if (!entry) {
            return -1 as unknown as TData;
          }
          const expectedVersion = Number(args[0]);
          const nextValue = String(args[1]);
          const ttl = Number(args[2]);
          const parsed = JSON.parse(entry.value) as { version: number };
          if (parsed.version !== expectedVersion) {
            evalConflictCount += 1;
            return 0 as unknown as TData;
          }
          records.set(key, { value: nextValue, ex: ttl });
          return 1 as unknown as TData;
        },
      };

      const store = new UpstashRedisSessionStore({ redis: statefulRedis });
      const baseTime = 1_700_000_000_000;
      const initial = createSession(baseTime, {
        id: "redis-10-burst",
        controllerKey: "ctrl-burst",
      });
      initial.examConfig = { startTimeMs: baseTime, durationMinutes: 120 };
      await store.create(initial);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, idx) =>
          store.mutate("redis-10-burst", (curr) => {
            const submitted = submitStudent(
              curr,
              {
                sex: idx % 2 === 0 ? "M" : "F",
                studentNumber: `BURST-${idx + 1}`,
                submittedBy: `Proctor-${idx + 1}`,
              },
              baseTime + 40 * 60_000 + idx,
            );
            return { session: submitted.session, result: submitted.entry.id };
          }),
        ),
      );

      expect(results).toHaveLength(10);
      expect(evalConflictCount).toBeGreaterThan(0);

      const finalSession = await store.get("redis-10-burst");
      expect(finalSession?.version).toBe(11);
      expect(finalSession?.entries).toHaveLength(10);
      expect(
        new Set(finalSession?.entries.map((e) => e.studentNumber)).size,
      ).toBe(10);
    });
  });

  describe("All 9 REST Endpoints Happy Paths", () => {
    it("supports full session lifecycle without leaking controllerKey", async () => {
      const startMs = Date.now() - 40 * 60_000;
      const created = await createTestSession();

      expect(created.sessionId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(created.joinUrl).toBe(`/s/${created.sessionId}`);
      expect(created.joinUrl).not.toContain(created.controllerKey);
      expect(created.controllerUrl).toBe(
        `/s/${created.sessionId}?key=${encodeURIComponent(created.controllerKey)}`,
      );
      expect("controllerKey" in created.snapshot).toBe(false);
      expect("alertSeq" in created.snapshot).toBe(false);

      // Join staff & verify case-insensitive dedupe
      const join1 = await joinSessionRoute(
        makeRequest(`/api/sessions/${created.sessionId}/join`, {
          method: "POST",
          body: { label: "  Room 101  " },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(join1.status).toBe(200);
      expect(join1.headers.get("cache-control")).toBe("no-store");
      const join1Body = (await join1.json()) as {
        staffId: string;
        label: string;
        snapshot: SessionSnapshot;
      };
      expect(join1Body.label).toBe("Room 101");

      const join2 = await joinSessionRoute(
        makeRequest(`/api/sessions/${created.sessionId}/join`, {
          method: "POST",
          body: { label: "room 101" },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(join2.status).toBe(200);
      const join2Body = (await join2.json()) as {
        staffId: string;
        label: string;
      };
      expect(join2Body.staffId).toBe(join1Body.staffId);
      expect(join2Body.label).toBe("room 101");

      // Configure exam window into ALLOWED
      const cfgRes = await updateConfigRoute(
        makeRequest(`/api/sessions/${created.sessionId}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": created.controllerKey },
          body: { startTimeMs: startMs, durationMinutes: 120 },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(cfgRes.status).toBe(200);
      expect(cfgRes.headers.get("cache-control")).toBe("no-store");
      const cfgBody = (await cfgRes.json()) as { snapshot: SessionSnapshot };
      expect(cfgBody.snapshot.windowStatus).toBe("ALLOWED");

      // Roaming staff submits M1, M2, F1
      const m1Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${created.sessionId}/entries`, {
          method: "POST",
          body: {
            sex: "M",
            studentNumber: "M-001",
            staffId: join1Body.staffId,
          },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(m1Res.status).toBe(201);
      expect(m1Res.headers.get("cache-control")).toBe("no-store");
      const m1Body = (await m1Res.json()) as {
        entry: { id: string; submittedBy: string };
        snapshot: SessionSnapshot;
      };
      expect(m1Body.entry.submittedBy).toBe("room 101");
      expect(m1Body.snapshot.nextBySex.M).toBe(m1Body.entry.id);
      expect(m1Body.snapshot.lastNextAlert?.studentNumber).toBe("M-001");

      const m2Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${created.sessionId}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "M-002", submittedBy: "Hallway" },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(m2Res.status).toBe(201);
      const m2Body = (await m2Res.json()) as { entry: { id: string } };

      const f1Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${created.sessionId}/entries`, {
          method: "POST",
          body: { sex: "F", studentNumber: "F-001" },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(f1Res.status).toBe(201);
      const f1Body = (await f1Res.json()) as { entry: { id: string } };

      // Reorder M2 up -> becomes next Male
      const reorderRes = await reorderRoute(
        makeRequest(`/api/sessions/${created.sessionId}/reorder`, {
          method: "POST",
          headers: { "x-controller-key": created.controllerKey },
          body: { entryId: m2Body.entry.id, direction: "up" },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(reorderRes.status).toBe(200);
      const reorderBody = (await reorderRes.json()) as {
        snapshot: SessionSnapshot;
      };
      expect(reorderBody.snapshot.nextBySex.M).toBe(m2Body.entry.id);

      // Simultaneous Male & Female enter bathroom
      const enterM2 = await entryActionRoute(
        makeRequest(
          `/api/sessions/${created.sessionId}/entries/${m2Body.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "enter" },
          },
        ),
        {
          params: Promise.resolve({
            id: created.sessionId,
            entryId: m2Body.entry.id,
          }),
        },
      );
      expect(enterM2.status).toBe(200);

      const enterF1 = await entryActionRoute(
        makeRequest(
          `/api/sessions/${created.sessionId}/entries/${f1Body.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "enter" },
          },
        ),
        {
          params: Promise.resolve({
            id: created.sessionId,
            entryId: f1Body.entry.id,
          }),
        },
      );
      expect(enterF1.status).toBe(200);

      // Second Male enter is rejected with 409 BATHROOM_OCCUPIED
      const enterM1Conflict = await entryActionRoute(
        makeRequest(
          `/api/sessions/${created.sessionId}/entries/${m1Body.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "enter" },
          },
        ),
        {
          params: Promise.resolve({
            id: created.sessionId,
            entryId: m1Body.entry.id,
          }),
        },
      );
      expect(enterM1Conflict.status).toBe(409);
      await expect(enterM1Conflict.json()).resolves.toMatchObject({
        code: "BATHROOM_OCCUPIED",
        details: { occupiedEntryId: m2Body.entry.id },
      });

      // Return M2, remove M1
      const returnM2 = await entryActionRoute(
        makeRequest(
          `/api/sessions/${created.sessionId}/entries/${m2Body.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "return" },
          },
        ),
        {
          params: Promise.resolve({
            id: created.sessionId,
            entryId: m2Body.entry.id,
          }),
        },
      );
      expect(returnM2.status).toBe(200);

      const removeM1 = await entryActionRoute(
        makeRequest(
          `/api/sessions/${created.sessionId}/entries/${m1Body.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "remove" },
          },
        ),
        {
          params: Promise.resolve({
            id: created.sessionId,
            entryId: m1Body.entry.id,
          }),
        },
      );
      expect(removeM1.status).toBe(200);

      // Clear session
      const clearRes = await clearSessionRoute(
        makeRequest(`/api/sessions/${created.sessionId}/clear`, {
          method: "POST",
          headers: { "x-controller-key": created.controllerKey },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(clearRes.status).toBe(200);
      expect(clearRes.headers.get("cache-control")).toBe("no-store");
      const clearBody = (await clearRes.json()) as {
        snapshot: SessionSnapshot;
      };
      expect(clearBody.snapshot.entries).toHaveLength(0);
      expect(clearBody.snapshot.clearedSeq).toBe(1);
      expect(clearBody.snapshot.staff).toHaveLength(1);
      expect(clearBody.snapshot.examConfig).not.toBeNull();
    });
  });

  describe("Strict JSON Validation, Auth & Error Mapping", () => {
    it("rejects malformed JSON, non-object bodies, and coerced/invalid field types with 400 INVALID_INPUT", async () => {
      const created = await createTestSession();
      const id = created.sessionId;
      const keyHeader = { "x-controller-key": created.controllerKey };

      // Malformed & non-object bodies
      for (const rawBody of ["{broken", "null", "[]", "123", '"hello"']) {
        const res = await createSessionRoute(
          makeRequest("/api/sessions", { method: "POST", rawBody }),
        );
        expect(res.status).toBe(400);
        expect(res.headers.get("cache-control")).toBe("no-store");
        await expect(res.json()).resolves.toMatchObject({
          code: "INVALID_INPUT",
        });
      }

      // Join non-string label
      const badJoin = await joinSessionRoute(
        makeRequest(`/api/sessions/${id}/join`, {
          method: "POST",
          body: { label: 123 },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(badJoin.status).toBe(400);
      await expect(badJoin.json()).resolves.toMatchObject({
        code: "INVALID_INPUT",
      });

      // Config null clockOffsetMs, string clockOffsetMs, invalid durationMinutes
      for (const body of [
        { startTimeMs: Date.now(), durationMinutes: 90, clockOffsetMs: null },
        { startTimeMs: Date.now(), durationMinutes: 90, clockOffsetMs: "0" },
        { startTimeMs: null, durationMinutes: 90 },
        { startTimeMs: Date.now(), durationMinutes: 0 },
      ]) {
        const res = await updateConfigRoute(
          makeRequest(`/api/sessions/${id}/config`, {
            method: "PATCH",
            headers: keyHeader,
            body,
          }),
          { params: Promise.resolve({ id }) },
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          code: "INVALID_INPUT",
        });
      }

      // Entries: override: "false" / 1 must return 400 (NOT coerce to true!)
      for (const body of [
        { sex: "M", studentNumber: "S1", override: "false" },
        { sex: "M", studentNumber: "S1", override: 1 },
        { sex: "M", studentNumber: 1001 },
        { sex: "M", studentNumber: "S1", staffId: 99 },
        { sex: "M", studentNumber: "S1", submittedBy: false },
        { sex: "X", studentNumber: "S1" },
      ]) {
        const res = await submitEntryRoute(
          makeRequest(`/api/sessions/${id}/entries`, {
            method: "POST",
            body,
          }),
          { params: Promise.resolve({ id }) },
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          code: "INVALID_INPUT",
        });
      }

      // Action: override: "false" / invalid action
      for (const body of [
        { action: "enter", override: "false" },
        { action: "invalid" },
      ]) {
        const res = await entryActionRoute(
          makeRequest(`/api/sessions/${id}/entries/e1/action`, {
            method: "POST",
            headers: keyHeader,
            body,
          }),
          { params: Promise.resolve({ id, entryId: "e1" }) },
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          code: "INVALID_INPUT",
        });
      }

      // Reorder: invalid fields
      for (const body of [
        { entryId: 123, direction: "up" },
        { entryId: "e1" },
        { entryId: "e1", direction: "up", targetIndex: 0 },
        { entryId: "e1", targetIndex: 1.5 },
      ]) {
        const res = await reorderRoute(
          makeRequest(`/api/sessions/${id}/reorder`, {
            method: "POST",
            headers: keyHeader,
            body,
          }),
          { params: Promise.resolve({ id }) },
        );
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({
          code: "INVALID_INPUT",
        });
      }

      // Malformed sinceVersion
      for (const q of ["abc", "1.5", ""]) {
        const res = await getSessionRoute(
          makeRequest(
            `/api/sessions/${id}?sinceVersion=${encodeURIComponent(q)}`,
          ),
          { params: Promise.resolve({ id }) },
        );
        expect(res.status).toBe(400);
        expect(res.headers.get("cache-control")).toBe("no-store");
        await expect(res.json()).resolves.toMatchObject({
          code: "INVALID_INPUT",
        });
      }
    });

    it("enforces x-controller-key (401 missing, 403 wrong, 404 missing session) and override auth", async () => {
      const created = await createTestSession();
      const id = created.sessionId;
      const startMs = Date.now() - 40 * 60_000;

      // Missing key -> 401
      const noKeyConfig = await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          body: { startTimeMs: startMs, durationMinutes: 120 },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(noKeyConfig.status).toBe(401);

      // Wrong key on existing session -> 403
      const wrongKeyClear = await clearSessionRoute(
        makeRequest(`/api/sessions/${id}/clear`, {
          method: "POST",
          headers: { "x-controller-key": "wrong-key" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(wrongKeyClear.status).toBe(403);

      // Any key on nonexistent session -> 404 (not 403)
      const missingClear = await clearSessionRoute(
        makeRequest("/api/sessions/nonexistent-id/clear", {
          method: "POST",
          headers: { "x-controller-key": "any-key" },
        }),
        { params: Promise.resolve({ id: "nonexistent-id" }) },
      );
      expect(missingClear.status).toBe(404);

      // Path traversal session ID -> 404
      const traversalGet = await getSessionRoute(
        makeRequest("/api/sessions/..%2Fsecret"),
        { params: Promise.resolve({ id: "../secret" }) },
      );
      expect(traversalGet.status).toBe(404);

      // Put session into ALLOWED window
      await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": created.controllerKey },
          body: { startTimeMs: startMs, durationMinutes: 120 },
        }),
        { params: Promise.resolve({ id }) },
      );

      // override: true requires x-controller-key even inside ALLOWED window
      const overrideNoKey = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "F", studentNumber: "F1", override: true },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(overrideNoKey.status).toBe(401);

      // Duplicate student -> 409 DUPLICATE_STUDENT
      const okSub = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "F", studentNumber: "F1" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(okSub.status).toBe(201);
      const okBody = (await okSub.json()) as { entry: { id: string } };

      const dupSub = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "F", studentNumber: "f1" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(dupSub.status).toBe(409);
      await expect(dupSub.json()).resolves.toMatchObject({
        code: "DUPLICATE_STUDENT",
      });

      // Invalid state transition (return while queued) -> 409 INVALID_STATE
      const badReturn = await entryActionRoute(
        makeRequest(`/api/sessions/${id}/entries/${okBody.entry.id}/action`, {
          method: "POST",
          headers: { "x-controller-key": created.controllerKey },
          body: { action: "return" },
        }),
        { params: Promise.resolve({ id, entryId: okBody.entry.id }) },
      );
      expect(badReturn.status).toBe(409);
      await expect(badReturn.json()).resolves.toMatchObject({
        code: "INVALID_STATE",
      });
    });

    it("blocks out-of-window submissions (403 OUTSIDE_TIME_WINDOW) and allows controller override", async () => {
      const created = await createTestSession();
      const id = created.sessionId;
      const now = Date.now();

      // FIRST_30_MIN: started 10 min ago, duration 90 min
      await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": created.controllerKey },
          body: { startTimeMs: now - 10 * 60_000, durationMinutes: 90 },
        }),
        { params: Promise.resolve({ id }) },
      );

      const blocked = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "S-OUT-1" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(blocked.status).toBe(403);
      await expect(blocked.json()).resolves.toMatchObject({
        code: "OUTSIDE_TIME_WINDOW",
        windowStatus: "FIRST_30_MIN",
      });

      // Controller override succeeds outside window
      const overrideAdd = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          headers: { "x-controller-key": created.controllerKey },
          body: { sex: "M", studentNumber: "S-OUT-1", override: true },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(overrideAdd.status).toBe(201);
      const addedBody = (await overrideAdd.json()) as {
        entry: { id: string; override: boolean };
      };
      expect(addedBody.entry.override).toBe(true);

      const enterWithoutOverride = await entryActionRoute(
        makeRequest(
          `/api/sessions/${id}/entries/${addedBody.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "enter" },
          },
        ),
        { params: Promise.resolve({ id, entryId: addedBody.entry.id }) },
      );
      expect(enterWithoutOverride.status).toBe(403);
      await expect(enterWithoutOverride.json()).resolves.toMatchObject({
        code: "OUTSIDE_TIME_WINDOW",
        windowStatus: "FIRST_30_MIN",
      });

      const enterWithOverride = await entryActionRoute(
        makeRequest(
          `/api/sessions/${id}/entries/${addedBody.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: "enter", override: true },
          },
        ),
        { params: Promise.resolve({ id, entryId: addedBody.entry.id }) },
      );
      expect(enterWithOverride.status).toBe(200);
    });
  });

  describe("sinceVersion & Live Fake-Timer Window Transitions", () => {
    it("evaluates live windowStatus on unchanged=true polling as time advances without mutations", async () => {
      vi.useFakeTimers();
      const baseStart = new Date("2026-11-25T10:00:00.000Z").getTime();
      vi.setSystemTime(baseStart + 5 * 60_000); // FIRST_30_MIN

      const created = await createTestSession();
      const id = created.sessionId;

      const cfgRes = await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": created.controllerKey },
          body: { startTimeMs: baseStart, durationMinutes: 90 },
        }),
        { params: Promise.resolve({ id }) },
      );
      const { snapshot } = (await cfgRes.json()) as {
        snapshot: SessionSnapshot;
      };
      const currentVersion = snapshot.version;
      expect(snapshot.windowStatus).toBe("FIRST_30_MIN");

      // ?sinceVersion=0 and ?sinceVersion=-5 return full snapshot
      for (const v of ["0", "-5"]) {
        const res = await getSessionRoute(
          makeRequest(`/api/sessions/${id}?sinceVersion=${v}`),
          { params: Promise.resolve({ id }) },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          unchanged: boolean;
          snapshot: SessionSnapshot;
        };
        expect(body.unchanged).toBe(false);
        expect(body.snapshot.version).toBe(currentVersion);
      }

      // Advance time with ZERO mutations across FIRST_30_MIN -> ALLOWED -> LAST_20_MIN -> AFTER_END
      const checkpoints: Array<{ offsetMin: number; expected: string }> = [
        { offsetMin: 15, expected: "FIRST_30_MIN" },
        { offsetMin: 30, expected: "ALLOWED" },
        { offsetMin: 70, expected: "LAST_20_MIN" },
        { offsetMin: 95, expected: "AFTER_END" },
      ];

      for (const cp of checkpoints) {
        const targetNow = baseStart + cp.offsetMin * 60_000;
        vi.setSystemTime(targetNow);
        const pollRes = await getSessionRoute(
          makeRequest(`/api/sessions/${id}?sinceVersion=${currentVersion}`),
          { params: Promise.resolve({ id }) },
        );
        expect(pollRes.status).toBe(200);
        expect(pollRes.headers.get("cache-control")).toBe("no-store");
        const pollBody = (await pollRes.json()) as {
          unchanged: boolean;
          version: number;
          serverNowMs: number;
          effectiveNowMs: number;
          windowStatus: string;
        };
        expect(pollBody).toEqual({
          unchanged: true,
          version: currentVersion,
          serverNowMs: targetNow,
          effectiveNowMs: targetNow,
          windowStatus: cp.expected,
        });
      }
    });
  });

  describe("Concurrency (10+ Parallel POST /entries)", () => {
    it("commits 12 parallel POST /entries requests with zero lost updates and deterministic FIFO order", async () => {
      const created = await createTestSession();
      const id = created.sessionId;

      const cfgRes = await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": created.controllerKey },
          body: {
            startTimeMs: Date.now() - 40 * 60_000,
            durationMinutes: 120,
          },
        }),
        { params: Promise.resolve({ id }) },
      );
      const { snapshot: cfgSnapshot } = (await cfgRes.json()) as {
        snapshot: SessionSnapshot;
      };
      const baseVersion = cfgSnapshot.version;

      const inputs = Array.from({ length: 12 }, (_, idx) => ({
        sex: idx % 2 === 0 ? ("M" as const) : ("F" as const),
        studentNumber: `STU-${String(idx + 1).padStart(3, "0")}`,
        submittedBy: `Staff-${idx + 1}`,
      }));

      const responses = await Promise.all(
        inputs.map((payload) =>
          submitEntryRoute(
            makeRequest(`/api/sessions/${id}/entries`, {
              method: "POST",
              body: payload,
            }),
            { params: Promise.resolve({ id }) },
          ),
        ),
      );

      for (const res of responses) {
        expect(res.status).toBe(201);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }

      const bodies = await Promise.all(
        responses.map(
          (r) =>
            r.json() as Promise<{
              entry: { id: string; sex: "M" | "F"; studentNumber: string };
              snapshot: SessionSnapshot;
            }>,
        ),
      );

      const versions = bodies
        .map((b) => b.snapshot.version)
        .sort((a, b) => a - b);
      expect(versions).toEqual(
        Array.from({ length: 12 }, (_, idx) => baseVersion + idx + 1),
      );

      const finalRes = await getSessionRoute(
        makeRequest(`/api/sessions/${id}`),
        { params: Promise.resolve({ id }) },
      );
      expect(finalRes.status).toBe(200);
      const finalBody = (await finalRes.json()) as {
        unchanged: boolean;
        snapshot: SessionSnapshot;
      };

      expect(finalBody.snapshot.version).toBe(baseVersion + 12);
      expect(finalBody.snapshot.entries).toHaveLength(12);

      const finalIds = new Set(finalBody.snapshot.entries.map((e) => e.id));
      expect(finalIds.size).toBe(12);
      for (const b of bodies) {
        expect(finalIds.has(b.entry.id)).toBe(true);
      }

      // Verify deterministic FIFO ordering: head of each sex equals first queued entry of that sex
      const firstMale = finalBody.snapshot.entries.find(
        (e) => e.sex === "M" && e.status === "queued",
      );
      const firstFemale = finalBody.snapshot.entries.find(
        (e) => e.sex === "F" && e.status === "queued",
      );
      expect(finalBody.snapshot.nextBySex.M).toBe(firstMale?.id ?? null);
      expect(finalBody.snapshot.nextBySex.F).toBe(firstFemale?.id ?? null);
    });
  });

  describe("Tier 3 Cross-Feature Concurrency & Window Transitions", () => {
    it("resolves concurrent duplicate POST /entries strictly as [201, 409] with 1 persisted entry", async () => {
      const created = await createTestSession();
      const id = created.sessionId;

      await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": created.controllerKey },
          body: {
            startTimeMs: Date.now() - 40 * 60_000,
            durationMinutes: 120,
          },
        }),
        { params: Promise.resolve({ id }) },
      );

      const [resA, resB] = await Promise.all([
        submitEntryRoute(
          makeRequest(`/api/sessions/${id}/entries`, {
            method: "POST",
            body: { sex: "M", studentNumber: "DUP-101", submittedBy: "Staff A" },
          }),
          { params: Promise.resolve({ id }) },
        ),
        submitEntryRoute(
          makeRequest(`/api/sessions/${id}/entries`, {
            method: "POST",
            body: { sex: "M", studentNumber: " dup-101 ", submittedBy: "Staff B" },
          }),
          { params: Promise.resolve({ id }) },
        ),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      await expect(conflictRes.json()).resolves.toMatchObject({
        code: "DUPLICATE_STUDENT",
      });

      const finalRes = await getSessionRoute(
        makeRequest(`/api/sessions/${id}`),
        { params: Promise.resolve({ id }) },
      );
      expect(finalRes.status).toBe(200);
      const finalBody = (await finalRes.json()) as {
        unchanged: boolean;
        snapshot: SessionSnapshot;
      };
      expect(finalBody.snapshot.entries).toHaveLength(1);
      expect(finalBody.snapshot.entries[0].studentNumber).toBe("DUP-101");
    });

    it("resolves concurrent same-sex enter actions strictly as [200, 409]", async () => {
      const created = await createTestSession();
      const id = created.sessionId;
      const keyHeader = { "x-controller-key": created.controllerKey };

      await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: keyHeader,
          body: {
            startTimeMs: Date.now() - 40 * 60_000,
            durationMinutes: 120,
          },
        }),
        { params: Promise.resolve({ id }) },
      );

      const m1Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "M-RACE-1" },
        }),
        { params: Promise.resolve({ id }) },
      );
      const m2Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "M-RACE-2" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(m1Res.status).toBe(201);
      expect(m2Res.status).toBe(201);
      const m1 = (await m1Res.json()) as { entry: { id: string } };
      const m2 = (await m2Res.json()) as { entry: { id: string } };

      const [enter1, enter2] = await Promise.all([
        entryActionRoute(
          makeRequest(`/api/sessions/${id}/entries/${m1.entry.id}/action`, {
            method: "POST",
            headers: keyHeader,
            body: { action: "enter" },
          }),
          { params: Promise.resolve({ id, entryId: m1.entry.id }) },
        ),
        entryActionRoute(
          makeRequest(`/api/sessions/${id}/entries/${m2.entry.id}/action`, {
            method: "POST",
            headers: keyHeader,
            body: { action: "enter" },
          }),
          { params: Promise.resolve({ id, entryId: m2.entry.id }) },
        ),
      ]);

      const statuses = [enter1.status, enter2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const conflictRes = enter1.status === 409 ? enter1 : enter2;
      await expect(conflictRes.json()).resolves.toMatchObject({
        code: "BATHROOM_OCCUPIED",
      });

      const finalRes = await getSessionRoute(
        makeRequest(`/api/sessions/${id}`),
        { params: Promise.resolve({ id }) },
      );
      const finalBody = (await finalRes.json()) as {
        unchanged: boolean;
        snapshot: SessionSnapshot;
      };
      const inBathroom = finalBody.snapshot.entries.filter(
        (e) => e.status === "in_bathroom",
      );
      const queued = finalBody.snapshot.entries.filter(
        (e) => e.status === "queued",
      );
      expect(inBathroom).toHaveLength(1);
      expect(queued).toHaveLength(1);
    });

    it("enforces mid-exam PATCH /config duration shortening (ALLOWED -> LAST_20_MIN) on staff submit and override enter", async () => {
      vi.useFakeTimers();
      const baseStart = new Date("2026-11-25T10:00:00.000Z").getTime();
      vi.setSystemTime(baseStart + 40 * 60_000); // 40m elapsed

      const created = await createTestSession();
      const id = created.sessionId;
      const keyHeader = { "x-controller-key": created.controllerKey };

      // 90m exam: allowed [30m, 70m) -> at 40m status is ALLOWED
      const cfg1 = await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: keyHeader,
          body: { startTimeMs: baseStart, durationMinutes: 90 },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(cfg1.status).toBe(200);
      await expect(cfg1.json()).resolves.toMatchObject({
        snapshot: { windowStatus: "ALLOWED" },
      });

      const m1Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "M-SHORT-1" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(m1Res.status).toBe(201);
      const m1 = (await m1Res.json()) as { entry: { id: string } };

      // Shorten duration to 55m: last 20m starts at 35m -> at 40m status moves to LAST_20_MIN
      const cfg2 = await updateConfigRoute(
        makeRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: keyHeader,
          body: { startTimeMs: baseStart, durationMinutes: 55 },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(cfg2.status).toBe(200);
      await expect(cfg2.json()).resolves.toMatchObject({
        snapshot: { windowStatus: "LAST_20_MIN" },
      });

      // Staff submission is now blocked (403)
      const blockedStaff = await submitEntryRoute(
        makeRequest(`/api/sessions/${id}/entries`, {
          method: "POST",
          body: { sex: "F", studentNumber: "F-SHORT-1" },
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(blockedStaff.status).toBe(403);
      await expect(blockedStaff.json()).resolves.toMatchObject({
        code: "OUTSIDE_TIME_WINDOW",
        windowStatus: "LAST_20_MIN",
      });

      // Normal enter without override is blocked (403), override enter succeeds (200)
      const blockedEnter = await entryActionRoute(
        makeRequest(`/api/sessions/${id}/entries/${m1.entry.id}/action`, {
          method: "POST",
          headers: keyHeader,
          body: { action: "enter" },
        }),
        { params: Promise.resolve({ id, entryId: m1.entry.id }) },
      );
      expect(blockedEnter.status).toBe(403);

      const overrideEnter = await entryActionRoute(
        makeRequest(`/api/sessions/${id}/entries/${m1.entry.id}/action`, {
          method: "POST",
          headers: keyHeader,
          body: { action: "enter", override: true },
        }),
        { params: Promise.resolve({ id, entryId: m1.entry.id }) },
      );
      expect(overrideEnter.status).toBe(200);
      const overrideBody = (await overrideEnter.json()) as {
        snapshot: SessionSnapshot;
      };
      expect(overrideBody.snapshot.entries[0].status).toBe("in_bathroom");
      expect(overrideBody.snapshot.entries[0].override).toBe(true);
    });

    it("anchors FileSessionStore sessionLocks on globalThis[Symbol.for('examq.fileSessionLocks')]", () => {
      const g = globalThis as unknown as Record<symbol, unknown>;
      const locks = g[Symbol.for("examq.fileSessionLocks")];
      expect(locks).toBeInstanceOf(Map);
    });

    it("enforces multi-room isolation (Hall A vs Hall B cross-key 403 and clear isolation)", async () => {
      const hallA = await createTestSession();
      const hallB = await createTestSession();
      const startMs = Date.now() - 40 * 60_000;

      // Configure both rooms into ALLOWED
      for (const room of [hallA, hallB]) {
        const cfg = await updateConfigRoute(
          makeRequest(`/api/sessions/${room.sessionId}/config`, {
            method: "PATCH",
            headers: { "x-controller-key": room.controllerKey },
            body: { startTimeMs: startMs, durationMinutes: 120 },
          }),
          { params: Promise.resolve({ id: room.sessionId }) },
        );
        expect(cfg.status).toBe(200);
      }

      // Submit students to Hall A and Hall B
      const aM1 = await submitEntryRoute(
        makeRequest(`/api/sessions/${hallA.sessionId}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "HALL-A-1" },
        }),
        { params: Promise.resolve({ id: hallA.sessionId }) },
      );
      expect(aM1.status).toBe(201);

      const bM1Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}/entries`, {
          method: "POST",
          body: { sex: "M", studentNumber: "HALL-B-1" },
        }),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      const bF1Res = await submitEntryRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}/entries`, {
          method: "POST",
          body: { sex: "F", studentNumber: "HALL-B-2" },
        }),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      expect(bM1Res.status).toBe(201);
      expect(bF1Res.status).toBe(201);
      const bM1 = (await bM1Res.json()) as { entry: { id: string } };

      // Hall A's controllerKey is rejected with 403 on every Hall B controller mutation
      const crossConfig = await updateConfigRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}/config`, {
          method: "PATCH",
          headers: { "x-controller-key": hallA.controllerKey },
          body: { startTimeMs: startMs, durationMinutes: 90 },
        }),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      expect(crossConfig.status).toBe(403);

      const crossOverride = await submitEntryRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}/entries`, {
          method: "POST",
          headers: { "x-controller-key": hallA.controllerKey },
          body: { sex: "M", studentNumber: "INTRUDER", override: true },
        }),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      expect(crossOverride.status).toBe(403);

      const crossAction = await entryActionRoute(
        makeRequest(
          `/api/sessions/${hallB.sessionId}/entries/${bM1.entry.id}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": hallA.controllerKey },
            body: { action: "enter" },
          },
        ),
        { params: Promise.resolve({ id: hallB.sessionId, entryId: bM1.entry.id }) },
      );
      expect(crossAction.status).toBe(403);

      const crossReorder = await reorderRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}/reorder`, {
          method: "POST",
          headers: { "x-controller-key": hallA.controllerKey },
          body: { entryId: bM1.entry.id, direction: "down" },
        }),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      expect(crossReorder.status).toBe(403);

      const crossClear = await clearSessionRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}/clear`, {
          method: "POST",
          headers: { "x-controller-key": hallA.controllerKey },
        }),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      expect(crossClear.status).toBe(403);

      // Clearing Hall A wipes Hall A while leaving Hall B completely intact
      const clearHallA = await clearSessionRoute(
        makeRequest(`/api/sessions/${hallA.sessionId}/clear`, {
          method: "POST",
          headers: { "x-controller-key": hallA.controllerKey },
        }),
        { params: Promise.resolve({ id: hallA.sessionId }) },
      );
      expect(clearHallA.status).toBe(200);
      const clearHallABody = (await clearHallA.json()) as {
        snapshot: SessionSnapshot;
      };
      expect(clearHallABody.snapshot.entries).toHaveLength(0);
      expect(clearHallABody.snapshot.clearedSeq).toBe(1);

      const hallBGet = await getSessionRoute(
        makeRequest(`/api/sessions/${hallB.sessionId}`),
        { params: Promise.resolve({ id: hallB.sessionId }) },
      );
      expect(hallBGet.status).toBe(200);
      const hallBBody = (await hallBGet.json()) as {
        snapshot: SessionSnapshot;
      };
      expect(hallBBody.snapshot.clearedSeq).toBe(0);
      expect(hallBBody.snapshot.entries.map((e) => e.studentNumber)).toEqual([
        "HALL-B-1",
        "HALL-B-2",
      ]);
      expect(hallBBody.snapshot.nextBySex.M).toBe(bM1.entry.id);
    });
  });
});
