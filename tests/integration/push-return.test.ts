import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateVAPIDKeys } from "web-push";

const { mockSendNotification, mockSetVapidDetails } = vi.hoisted(() => ({
  mockSendNotification: vi.fn(),
  mockSetVapidDetails: vi.fn(),
}));

vi.mock("web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("web-push")>();
  return {
    ...actual,
    sendNotification: mockSendNotification,
    setVapidDetails: mockSetVapidDetails,
  };
});

import { POST as createSessionRoute } from "@/app/api/sessions/route";
import { PATCH as updateConfigRoute } from "@/app/api/sessions/[id]/config/route";
import { POST as submitEntryRoute } from "@/app/api/sessions/[id]/entries/route";
import { POST as entryActionRoute } from "@/app/api/sessions/[id]/entries/[entryId]/action/route";
import { POST as joinSessionRoute } from "@/app/api/sessions/[id]/join/route";
import { POST as pushSubscribeRoute } from "@/app/api/sessions/[id]/push-subscribe/route";
import { getSessionStore, resetSessionStoreForTests } from "@/lib/storage";
import { sendNextStudentPushNotifications } from "@/lib/push/sendPush";
import type { SessionSnapshot } from "@/lib/domain";

function makeRequest(
  urlPath: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): NextRequest {
  const headers = new Headers(options?.headers);
  let body: string | undefined;
  if (options?.body !== undefined) {
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

describe("Consecutive Return-to-Ready Web Push Dispatch Integration", () => {
  let tempDir = "";
  let prevDataDir: string | undefined;
  let prevVapidPub: string | undefined;
  let prevVapidPriv: string | undefined;
  let prevVapidSub: string | undefined;

  beforeEach(async () => {
    prevDataDir = process.env.EXAMQ_DATA_DIR;
    prevVapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    prevVapidPriv = process.env.VAPID_PRIVATE_KEY;
    prevVapidSub = process.env.VAPID_SUBJECT;

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "examq-push-int-"));
    process.env.EXAMQ_DATA_DIR = tempDir;

    const vapid = generateVAPIDKeys();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = "mailto:test@examq.local";

    resetSessionStoreForTests();
    mockSendNotification.mockReset();
    mockSetVapidDetails.mockReset();
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
  });

  afterEach(async () => {
    resetSessionStoreForTests();
    if (prevDataDir === undefined) delete process.env.EXAMQ_DATA_DIR;
    else process.env.EXAMQ_DATA_DIR = prevDataDir;
    if (prevVapidPub === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevVapidPub;
    if (prevVapidPriv === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = prevVapidPriv;
    if (prevVapidSub === undefined) delete process.env.VAPID_SUBJECT;
    else process.env.VAPID_SUBJECT = prevVapidSub;

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("dispatches Web Push with unique per-seq tags to Controller and all Staff subscribers on every return-to-ready turn, and stays silent on empty-queue return", async () => {
    const createRes = await createSessionRoute(
      makeRequest("/api/sessions", { method: "POST", body: {} }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      sessionId: string;
      controllerKey: string;
      snapshot: SessionSnapshot;
    };

    const startMs = Date.now() - 40 * 60_000;
    const cfgRes = await updateConfigRoute(
      makeRequest(`/api/sessions/${created.sessionId}/config`, {
        method: "PATCH",
        headers: { "x-controller-key": created.controllerKey },
        body: { startTimeMs: startMs, durationMinutes: 120 },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    expect(cfgRes.status).toBe(200);

    const joinStaff1 = await joinSessionRoute(
      makeRequest(`/api/sessions/${created.sessionId}/join`, {
        method: "POST",
        body: { label: "Hall 1", inviteCode: created.snapshot.inviteCode },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    expect(joinStaff1.status).toBe(200);
    const staff1 = (await joinStaff1.json()) as { staffToken: string };

    const joinStaff2 = await joinSessionRoute(
      makeRequest(`/api/sessions/${created.sessionId}/join`, {
        method: "POST",
        body: { label: "Hall 2", inviteCode: created.snapshot.inviteCode },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    expect(joinStaff2.status).toBe(200);
    const staff2 = (await joinStaff2.json()) as { staffToken: string };

    const endpoints = [
      "https://push.example.com/controller",
      "https://push.example.com/staff-1",
      "https://push.example.com/staff-2",
    ];
    const authHeaders: Array<Record<string, string>> = [
      { "x-controller-key": created.controllerKey },
      { "x-staff-token": staff1.staffToken },
      { "x-staff-token": staff2.staffToken },
    ];

    for (let i = 0; i < endpoints.length; i += 1) {
      const subRes = await pushSubscribeRoute(
        makeRequest(`/api/sessions/${created.sessionId}/push-subscribe`, {
          method: "POST",
          headers: authHeaders[i],
          body: {
            endpoint: endpoints[i],
            keys: { p256dh: `p256-${i}`, auth: `auth-${i}` },
          },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(subRes.status).toBe(200);
    }

    const submit = async (sex: "M" | "F", studentNumber: string) => {
      const res = await submitEntryRoute(
        makeRequest(`/api/sessions/${created.sessionId}/entries`, {
          method: "POST",
          headers: { "x-staff-token": staff1.staffToken },
          body: { sex, studentNumber },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(res.status).toBe(201);
      return (await res.json()) as {
        entry: { id: string };
        snapshot: SessionSnapshot;
      };
    };

    const action = async (entryId: string, act: "enter" | "return") => {
      const res = await entryActionRoute(
        makeRequest(
          `/api/sessions/${created.sessionId}/entries/${entryId}/action`,
          {
            method: "POST",
            headers: { "x-controller-key": created.controllerKey },
            body: { action: act },
          },
        ),
        { params: Promise.resolve({ id: created.sessionId, entryId }) },
      );
      expect(res.status).toBe(200);
      return (await res.json()) as { snapshot: SessionSnapshot };
    };

    const m1 = await submit("M", "M-101");
    const m2 = await submit("M", "M-102");
    const m3 = await submit("M", "M-103");
    expect(m1.snapshot.lastNextAlert?.seq).toBe(1);

    mockSendNotification.mockClear();

    // Turn 1: M1 enters -> M2 head (seq 2), then M1 returns -> M2 ready (seq 3)
    const enterM1 = await action(m1.entry.id, "enter");
    expect(enterM1.snapshot.lastNextAlert?.seq).toBe(2);
    expect(mockSendNotification).toHaveBeenCalledTimes(3);

    mockSendNotification.mockClear();
    const returnM1 = await action(m1.entry.id, "return");
    expect(returnM1.snapshot.lastNextAlert?.seq).toBe(3);
    expect(returnM1.snapshot.lastNextAlert?.studentNumber).toBe("M-102");
    expect(mockSendNotification).toHaveBeenCalledTimes(3);

    const tagsAfterReturn1 = mockSendNotification.mock.calls.map((call) => {
      const sub = call[0] as { endpoint: string };
      const payload = JSON.parse(call[1] as string) as { tag: string; url: string };
      return { endpoint: sub.endpoint, tag: payload.tag, url: payload.url };
    });
    expect(tagsAfterReturn1.map((x) => x.endpoint).sort()).toEqual([...endpoints].sort());
    for (const item of tagsAfterReturn1) {
      expect(item.tag).toBe(`examq-next-${created.sessionId}-M-3`);
      expect(item.url).toBe(`/s/${encodeURIComponent(created.sessionId)}`);
    }

    // Turn 2: M2 enters -> M3 head (seq 4), then M2 returns -> M3 ready (seq 5)
    mockSendNotification.mockClear();
    await action(m2.entry.id, "enter");
    expect(mockSendNotification).toHaveBeenCalledTimes(3);

    mockSendNotification.mockClear();
    const returnM2 = await action(m2.entry.id, "return");
    expect(returnM2.snapshot.lastNextAlert?.seq).toBe(5);
    expect(returnM2.snapshot.lastNextAlert?.studentNumber).toBe("M-103");
    expect(mockSendNotification).toHaveBeenCalledTimes(3);
    for (const call of mockSendNotification.mock.calls) {
      const payload = JSON.parse(call[1] as string) as { tag: string };
      expect(payload.tag).toBe(`examq-next-${created.sessionId}-M-5`);
    }

    // Turn 3: M3 enters (queue empty -> stays seq 5, 0 pushes) -> M3 returns (empty queue -> stays seq 5, 0 pushes)
    mockSendNotification.mockClear();
    const enterM3 = await action(m3.entry.id, "enter");
    expect(enterM3.snapshot.lastNextAlert?.seq).toBe(5);
    expect(mockSendNotification).not.toHaveBeenCalled();

    const returnM3 = await action(m3.entry.id, "return");
    expect(returnM3.snapshot.lastNextAlert?.seq).toBe(5);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("prunes 404/410 expired subscriptions, logs non-404/410 failures, and returns accurate PushDeliverySummary", async () => {
    const createRes = await createSessionRoute(
      makeRequest("/api/sessions", { method: "POST", body: {} }),
    );
    const created = (await createRes.json()) as {
      sessionId: string;
      controllerKey: string;
      snapshot: SessionSnapshot;
    };

    const startMs = Date.now() - 40 * 60_000;
    await updateConfigRoute(
      makeRequest(`/api/sessions/${created.sessionId}/config`, {
        method: "PATCH",
        headers: { "x-controller-key": created.controllerKey },
        body: { startTimeMs: startMs, durationMinutes: 120 },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );

    const joinStaff1 = await joinSessionRoute(
      makeRequest(`/api/sessions/${created.sessionId}/join`, {
        method: "POST",
        body: { label: "Hall 1", inviteCode: created.snapshot.inviteCode },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    const staff1 = (await joinStaff1.json()) as { staffToken: string };

    const joinStaff2 = await joinSessionRoute(
      makeRequest(`/api/sessions/${created.sessionId}/join`, {
        method: "POST",
        body: { label: "Hall 2", inviteCode: created.snapshot.inviteCode },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    const staff2 = (await joinStaff2.json()) as { staffToken: string };

    const expiredEndpoint = "https://push.example.com/expired";
    const failingEndpoint = "https://push.example.com/failing";
    const healthyEndpoint = "https://push.example.com/healthy";

    await pushSubscribeRoute(
      makeRequest(`/api/sessions/${created.sessionId}/push-subscribe`, {
        method: "POST",
        headers: { "x-controller-key": created.controllerKey },
        body: { endpoint: expiredEndpoint, keys: { p256dh: "p1", auth: "a1" } },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    await pushSubscribeRoute(
      makeRequest(`/api/sessions/${created.sessionId}/push-subscribe`, {
        method: "POST",
        headers: { "x-staff-token": staff1.staffToken },
        body: { endpoint: failingEndpoint, keys: { p256dh: "p2", auth: "a2" } },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );
    await pushSubscribeRoute(
      makeRequest(`/api/sessions/${created.sessionId}/push-subscribe`, {
        method: "POST",
        headers: { "x-staff-token": staff2.staffToken },
        body: { endpoint: healthyEndpoint, keys: { p256dh: "p3", auth: "a3" } },
      }),
      { params: Promise.resolve({ id: created.sessionId }) },
    );

    mockSendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === expiredEndpoint) {
        const err = new Error("Gone") as Error & { statusCode?: number };
        err.statusCode = 410;
        throw err;
      }
      if (sub.endpoint === failingEndpoint) {
        const err = new Error("Bad VAPID") as Error & { statusCode?: number };
        err.statusCode = 403;
        throw err;
      }
      return { statusCode: 201 };
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const subRes = await submitEntryRoute(
        makeRequest(`/api/sessions/${created.sessionId}/entries`, {
          method: "POST",
          headers: { "x-controller-key": created.controllerKey },
          body: { sex: "F", studentNumber: "F-900", override: true },
        }),
        { params: Promise.resolve({ id: created.sessionId }) },
      );
      expect(subRes.status).toBe(201);

      const stored = await getSessionStore().get(created.sessionId);
      expect(stored?.pushSubscriptions?.map((s) => s.endpoint)).toEqual([
        failingEndpoint,
        healthyEndpoint,
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // Direct call returns accurate PushDeliverySummary
      const summary = await sendNextStudentPushNotifications(
        created.sessionId,
        stored!,
        0,
      );
      expect(summary).toEqual({
        attempted: 2,
        sent: 1,
        expiredPruned: 0,
        failed: 1,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
