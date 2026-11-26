import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as createSessionRoute } from "@/app/api/sessions/route";
import { GET as getSessionRoute } from "@/app/api/sessions/[id]/route";
import { POST as clearSessionRoute } from "@/app/api/sessions/[id]/clear/route";
import { PATCH as updateConfigRoute } from "@/app/api/sessions/[id]/config/route";
import { POST as submitEntryRoute } from "@/app/api/sessions/[id]/entries/route";
import { POST as entryActionRoute } from "@/app/api/sessions/[id]/entries/[entryId]/action/route";
import { POST as joinSessionRoute } from "@/app/api/sessions/[id]/join/route";
import type { SessionSnapshot } from "@/lib/domain";
import {
  getSessionStore,
  getStorageHealth,
  resetSessionStoreForTests,
  StorageError,
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

function makeRawRequest(
  urlPath: string,
  options: {
    method: string;
    rawBody?: string;
    headers?: Record<string, string>;
  },
): NextRequest {
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: options.method,
    headers: options.headers,
    body: options.rawBody,
  });
}

async function createTestSession() {
  const res = await createSessionRoute(
    makeRawRequest("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      rawBody: "{}",
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as {
    sessionId: string;
    controllerKey: string;
    snapshot: SessionSnapshot;
  };
}

describe("Tier 5 Adversarial Storage & API Integration Tests", () => {
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "examq-t5-int-"));
    process.env.EXAMQ_DATA_DIR = tempDir;
    resetSessionStoreForTests();
  });

  afterEach(async () => {
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

  it("treats VERCEL=1 with whitespace Redis env vars and mismatched partial env vars as STORAGE_MISCONFIGURED (500)", async () => {
    process.env.VERCEL = "1";
    process.env.UPSTASH_REDIS_REST_URL = "   ";
    process.env.UPSTASH_REDIS_REST_TOKEN = "\t\n";

    const healthWhitespace = await getHealth();
    expect(healthWhitespace.status).toBe(500);
    await expect(healthWhitespace.json()).resolves.toMatchObject({
      ok: false,
      storage: "upstash-redis",
    });
    expect(() => getSessionStore()).toThrowError(StorageError);

    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "kv-token-only";

    expect(getStorageHealth()).toMatchObject({
      ok: false,
      storage: "upstash-redis",
    });
    const healthMismatch = await getHealth();
    expect(healthMismatch.status).toBe(500);
    expect(() => getSessionStore()).toThrowError(
      expect.objectContaining({ code: "STORAGE_MISCONFIGURED" }),
    );
  });

  it("maps corrupt stored session files (durationMinutes: 0, lastNextAlert: {}, entries: [null], 0-byte) to 500 CORRUPT_DATA (Bug 5)", async () => {
    const created = await createTestSession();
    const sessionFile = path.join(tempDir, `${created.sessionId}.json`);
    const baseData = JSON.parse(await fs.readFile(sessionFile, "utf8")) as Record<
      string,
      unknown
    >;

    const corruptVariants: Array<string> = [
      "",
      "{not-valid-json",
      JSON.stringify({
        ...baseData,
        examConfig: { startTimeMs: Date.now(), durationMinutes: 0 },
      }),
      JSON.stringify({
        ...baseData,
        lastNextAlert: {},
      }),
      JSON.stringify({
        ...baseData,
        entries: [null],
      }),
      JSON.stringify({
        ...baseData,
        staff: [{}],
      }),
    ];

    for (const payload of corruptVariants) {
      await fs.writeFile(sessionFile, payload, "utf8");
      const res = await getSessionRoute(
        makeRawRequest(`/api/sessions/${created.sessionId}`, { method: "GET" }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toMatchObject({
        code: "CORRUPT_DATA",
      });
    }
  });

  it("rejects out-of-Date-range timestamps and extreme clockOffsetMs without corrupting persisted session (Bug 4)", async () => {
    const created = await createTestSession();
    const id = created.sessionId;
    const keyHeader = { "x-controller-key": created.controllerKey };

    // Valid baseline config first
    const okCfg = await updateConfigRoute(
      makeRawRequest(`/api/sessions/${id}/config`, {
        method: "PATCH",
        headers: { ...keyHeader, "content-type": "application/json" },
        rawBody: JSON.stringify({
          startTimeMs: Date.now() - 40 * 60_000,
          durationMinutes: 120,
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(okCfg.status).toBe(200);

    // Extreme values must all fail with 400 INVALID_INPUT
    const extremePayloads = [
      { startTimeMs: 1e20, durationMinutes: 120 },
      { startTimeMs: -1e20, durationMinutes: 120 },
      { startTimeMs: Date.now(), durationMinutes: 1e20 },
      { startTimeMs: Date.now(), durationMinutes: 120, clockOffsetMs: 1e20 },
      { startTimeMs: Date.now(), durationMinutes: 120, clockOffsetMs: 8.64e15 },
    ];

    for (const payload of extremePayloads) {
      const res = await updateConfigRoute(
        makeRawRequest(`/api/sessions/${id}/config`, {
          method: "PATCH",
          headers: { ...keyHeader, "content-type": "application/json" },
          rawBody: JSON.stringify(payload),
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_INPUT",
      });
    }

    // Subsequent GET remains 200 and preserves original valid config
    const getAfter = await getSessionRoute(
      makeRawRequest(`/api/sessions/${id}`, {
        method: "GET",
        headers: { "x-controller-key": created.controllerKey },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(getAfter.status).toBe(200);
    const getBody = (await getAfter.json()) as {
      unchanged: boolean;
      snapshot: SessionSnapshot;
    };
    expect(getBody.snapshot.examConfig?.durationMinutes).toBe(120);
    expect(getBody.snapshot.windowStatus).toBe("ALLOWED");
  });

  it("handles adversarial Content-Types, JSON primitives, prototype-pollution payloads, sinceVersion edges, auth headers, and action/clear edges", async () => {
    const created = await createTestSession();
    const id = created.sessionId;
    const key = created.controllerKey;

    // Non-JSON / malformed Content-Type bodies on POST /api/sessions
    for (const [ct, rawBody] of [
      ["text/plain", "hello world"],
      ["application/x-www-form-urlencoded", "foo=bar&baz=1"],
      ["application/json", "true"],
      ["application/json", '"string"'],
      ["application/json", "123"],
      ["application/json", "[]"],
    ] as const) {
      const res = await createSessionRoute(
        makeRawRequest("/api/sessions", {
          method: "POST",
          headers: { "content-type": ct },
          rawBody,
        }),
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_INPUT",
      });
    }

    // Prototype pollution payloads do not pollute Object.prototype
    const protoCreate = await createSessionRoute(
      makeRawRequest("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        rawBody:
          '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}',
      }),
    );
    expect(protoCreate.status).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();

    // sinceVersion edge cases
    const minusZeroRes = await getSessionRoute(
      makeRawRequest(`/api/sessions/${id}?sinceVersion=-0`, {
        method: "GET",
        headers: { "x-controller-key": key },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(minusZeroRes.status).toBe(200);
    await expect(minusZeroRes.json()).resolves.toMatchObject({
      unchanged: false,
    });

    for (const badSince of ["9007199254740992", "1.0", "1e2", "NaN", " 1"]) {
      const res = await getSessionRoute(
        makeRawRequest(
          `/api/sessions/${id}?sinceVersion=${encodeURIComponent(badSince)}`,
          { method: "GET" },
        ),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_INPUT",
      });
    }

    // x-controller-key whitespace -> 401; comma-joined multi-header -> 403
    const wsKeyRes = await clearSessionRoute(
      makeRawRequest(`/api/sessions/${id}/clear`, {
        method: "POST",
        headers: { "x-controller-key": "   \t  " },
        rawBody: "{}",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(wsKeyRes.status).toBe(401);

    const multiKeyHeaders = new Headers();
    multiKeyHeaders.append("x-controller-key", key);
    multiKeyHeaders.append("x-controller-key", "extra-key");
    const multiKeyRes = await clearSessionRoute(
      new NextRequest(`http://localhost:3000/api/sessions/${id}/clear`, {
        method: "POST",
        headers: multiKeyHeaders,
        body: "{}",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(multiKeyRes.status).toBe(403);

    // action with whitespace entryId -> 400; missing session -> 404
    const wsEntryAction = await entryActionRoute(
      makeRawRequest(`/api/sessions/${id}/entries/%20%20%20/action`, {
        method: "POST",
        headers: { "x-controller-key": key, "content-type": "application/json" },
        rawBody: JSON.stringify({ action: "enter" }),
      }),
      { params: Promise.resolve({ id, entryId: "   " }) },
    );
    expect(wsEntryAction.status).toBe(400);

    const missingSessionAction = await entryActionRoute(
      makeRawRequest(`/api/sessions/no-such-session/entries/e1/action`, {
        method: "POST",
        headers: { "x-controller-key": key, "content-type": "application/json" },
        rawBody: JSON.stringify({ action: "enter" }),
      }),
      { params: Promise.resolve({ id: "no-such-session", entryId: "e1" }) },
    );
    expect(missingSessionAction.status).toBe(404);

    // POST /clear non-object JSON -> 400
    for (const badClearBody of ["[]", '"str"', "123", "null"]) {
      const res = await clearSessionRoute(
        makeRawRequest(`/api/sessions/${id}/clear`, {
          method: "POST",
          headers: {
            "x-controller-key": key,
            "content-type": "application/json",
          },
          rawBody: badClearBody,
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_INPUT",
      });
    }

    // Bug 7 via REST API: padded staffId resolves joined staff label
    await updateConfigRoute(
      makeRawRequest(`/api/sessions/${id}/config`, {
        method: "PATCH",
        headers: { "x-controller-key": key, "content-type": "application/json" },
        rawBody: JSON.stringify({
          startTimeMs: Date.now() - 40 * 60_000,
          durationMinutes: 120,
        }),
      }),
      { params: Promise.resolve({ id }) },
    );

    const joinRes = await joinSessionRoute(
      makeRawRequest(`/api/sessions/${id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        rawBody: JSON.stringify({
          label: "Gym Wing",
          inviteCode: created.snapshot.inviteCode,
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(joinRes.status).toBe(200);
    const joinBody = (await joinRes.json()) as {
      staffId: string;
      staffToken: string;
    };

    const submitWithPaddedId = await submitEntryRoute(
      makeRawRequest(`/api/sessions/${id}/entries`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-staff-token": joinBody.staffToken,
        },
        rawBody: JSON.stringify({
          sex: "M",
          studentNumber: "TRIM-1",
          staffId: `  ${joinBody.staffId}  `,
          submittedBy: "Fallback",
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(submitWithPaddedId.status).toBe(201);
    await expect(submitWithPaddedId.json()).resolves.toMatchObject({
      entry: {
        studentNumber: "TRIM-1",
        submittedBy: "Gym Wing",
      },
    });
  });
});
