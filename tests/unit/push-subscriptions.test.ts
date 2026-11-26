import { describe, expect, it } from "vitest";
import {
  acknowledgeAlert,
  createSession,
  joinStaff,
  prunePushSubscriptions,
  removePushSubscription,
  rotateInvite,
  submitStudent,
  toSessionSnapshot,
  updateExamConfig,
  upsertPushSubscription,
} from "../../src/lib/domain";

describe("push subscription domain helpers", () => {
  it("upserts, updates, and removes push subscriptions while keeping them redacted from snapshots", () => {
    const initial = createSession(1_700_000_000_000, {
      id: "push-test-1",
    });

    const sub1 = upsertPushSubscription(
      initial,
      {
        endpoint: "https://push.example.com/sub/1",
        keys: { p256dh: "p256-1", auth: "auth-1" },
        actorKey: "controller",
      },
      1_700_000_001_000,
    );

    expect(sub1.pushSubscriptions).toHaveLength(1);
    expect(sub1.pushSubscriptions?.[0]).toMatchObject({
      endpoint: "https://push.example.com/sub/1",
      actorKey: "controller",
      updatedAt: 1_700_000_001_000,
    });

    // Re-upserting the same endpoint updates keys and updatedAt without duplicating
    const sub1Updated = upsertPushSubscription(
      sub1,
      {
        endpoint: "https://push.example.com/sub/1",
        keys: { p256dh: "p256-1b", auth: "auth-1b" },
        actorKey: "staff:s1",
      },
      1_700_000_002_000,
    );

    expect(sub1Updated.pushSubscriptions).toHaveLength(1);
    expect(sub1Updated.pushSubscriptions?.[0]).toMatchObject({
      keys: { p256dh: "p256-1b", auth: "auth-1b" },
      actorKey: "staff:s1",
      updatedAt: 1_700_000_002_000,
    });

    // Snapshot must NEVER expose pushSubscriptions
    const snapshot = toSessionSnapshot(sub1Updated, 1_700_000_002_000);
    expect("pushSubscriptions" in snapshot).toBe(false);

    // Add second subscription, prune first, remove second
    const sub2 = upsertPushSubscription(
      sub1Updated,
      {
        endpoint: "https://push.example.com/sub/2",
        keys: { p256dh: "p256-2", auth: "auth-2" },
        actorKey: "controller",
      },
      1_700_000_003_000,
    );
    expect(sub2.pushSubscriptions).toHaveLength(2);

    const pruned = prunePushSubscriptions(sub2, [
      "https://push.example.com/sub/1",
    ]);
    expect(pruned.pushSubscriptions).toHaveLength(1);
    expect(pruned.pushSubscriptions?.[0]?.endpoint).toBe(
      "https://push.example.com/sub/2",
    );

    const removed = removePushSubscription(
      pruned,
      "https://push.example.com/sub/2",
    );
    expect(removed.pushSubscriptions).toHaveLength(0);
  });

  it("atomically acknowledges alerts and prunes staff tokens + staff push subscriptions on rotateInvite", () => {
    const start = 1_700_000_000_000;
    let session = createSession(start, { id: "ack-rotate-1" });
    session = updateExamConfig(
      session,
      { startTimeMs: start, durationMinutes: 120, firstBlockMinutes: 0, lastBlockMinutes: 0 },
      start,
    );
    const joined = joinStaff(session, { label: "Hall A" }, start + 1000);
    session = joined.session;

    session = upsertPushSubscription(
      session,
      {
        endpoint: "https://push.example.com/controller",
        keys: { p256dh: "c1", auth: "a1" },
        actorKey: "controller",
      },
      start + 1500,
    );
    session = upsertPushSubscription(
      session,
      {
        endpoint: "https://push.example.com/staff-1",
        keys: { p256dh: "s1", auth: "a2" },
        actorKey: `staff:${joined.staff.id}`,
      },
      start + 1600,
    );

    const submitted = submitStudent(
      session,
      { sex: "M", studentNumber: "S101", staffId: joined.staff.id },
      start + 2000,
    );
    session = submitted.session;
    const seq = session.lastNextAlert!.seq;

    // First acknowledgment wins atomically
    const acked1 = acknowledgeAlert(
      session,
      { actorKey: `staff:${joined.staff.id}`, label: "Hall A", seq },
      start + 3000,
    );
    expect(acked1.lastNextAlert?.acknowledgedBy).toEqual({
      actorKey: `staff:${joined.staff.id}`,
      label: "Hall A",
      at: start + 3000,
    });

    // Second acknowledgment for same seq is ignored (no overwrite)
    const acked2 = acknowledgeAlert(
      acked1,
      { actorKey: "controller", label: "Controller", seq },
      start + 4000,
    );
    expect(acked2.lastNextAlert?.acknowledgedBy?.label).toBe("Hall A");

    // Rotating invite invalidates staffTokens and removes staff:* push subscriptions, keeping controller's
    const rotated = rotateInvite(acked2, start + 5000);
    expect(rotated.staffTokens).toEqual({});
    expect(rotated.pushSubscriptions?.map((s) => s.actorKey)).toEqual([
      "controller",
    ]);
  });
});
