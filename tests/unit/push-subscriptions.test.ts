import { describe, expect, it } from "vitest";
import {
  createSession,
  prunePushSubscriptions,
  removePushSubscription,
  toSessionSnapshot,
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
});
