import { sendNotification, setVapidDetails } from "web-push";
import type { ExamSession, PushSubscriptionRecord } from "@/lib/domain/types";
import { prunePushSubscriptions } from "@/lib/domain/queue";
import { getSessionStore } from "@/lib/storage";

let vapidConfiguredForKey: string | null = null;

function ensureVapidConfigured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:admin@examq.local";

  if (!publicKey || !privateKey) {
    return false;
  }

  const cacheKey = `${publicKey}:${privateKey}:${subject}`;
  if (vapidConfiguredForKey !== cacheKey) {
    setVapidDetails(subject, publicKey, privateKey);
    vapidConfiguredForKey = cacheKey;
  }
  return true;
}

export interface PushDeliverySummary {
  attempted: number;
  sent: number;
  expiredPruned: number;
  failed: number;
}

export async function sendNextStudentPushNotifications(
  sessionId: string,
  session: ExamSession,
  prevAlertSeq: number,
): Promise<PushDeliverySummary> {
  const alert = session.lastNextAlert;
  if (!alert || alert.seq <= prevAlertSeq) {
    return { attempted: 0, sent: 0, expiredPruned: 0, failed: 0 };
  }

  const subs = session.pushSubscriptions ?? [];
  if (subs.length === 0 || !ensureVapidConfigured()) {
    return { attempted: 0, sent: 0, expiredPruned: 0, failed: 0 };
  }

  const payload = JSON.stringify({
    title: "ExamQ · Queue updated",
    body: "Open ExamQ to check the current queue.",
    tag: `examq-next-${sessionId}-${alert.sex}-${alert.seq}`,
    url: `/s/${encodeURIComponent(sessionId)}`,
  });

  const expiredEndpoints: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          { TTL: 60 },
        );
        sent += 1;
      } catch (err) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        } else {
          failed += 1;
          console.error("[examq/push] Failed to send push notification", {
            sessionId,
            actorKey: sub.actorKey,
            seq: alert.seq,
            statusCode,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }),
  );

  if (expiredEndpoints.length > 0) {
    try {
      await getSessionStore().mutate(sessionId, (current) => ({
        session: prunePushSubscriptions(current, expiredEndpoints),
        result: null,
      }));
    } catch {
      // Best-effort cleanup
    }
  }

  return {
    attempted: subs.length,
    sent,
    expiredPruned: expiredEndpoints.length,
    failed,
  };
}

export async function sendTestPushNotification(
  sessionId: string,
  sub: PushSubscriptionRecord,
): Promise<{ sent: boolean; reason?: string }> {
  if (!ensureVapidConfigured()) {
    return { sent: false, reason: "VAPID keys not configured on server." };
  }

  const payload = JSON.stringify({
    title: "ExamQ · Lock-screen test",
    body: "Quiet alert check — tap to return to ExamQ.",
    tag: `examq-test-${sessionId}-${Date.now()}`,
    url: `/s/${encodeURIComponent(sessionId)}`,
  });

  try {
    await sendNotification(
      {
        endpoint: sub.endpoint,
        keys: sub.keys,
      },
      payload,
      { TTL: 60 },
    );
    return { sent: true };
  } catch (err) {
    const statusCode =
      typeof err === "object" && err !== null && "statusCode" in err
        ? (err as { statusCode?: number }).statusCode
        : undefined;
    if (statusCode === 404 || statusCode === 410) {
      await getSessionStore()
        .mutate(sessionId, (current) => ({
          session: prunePushSubscriptions(current, [sub.endpoint]),
          result: null,
        }))
        .catch(() => {});
      return { sent: false, reason: "Push subscription expired." };
    }
    console.error("[examq/push] Failed to send test push notification", {
      sessionId,
      actorKey: sub.actorKey,
      statusCode,
      error: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, reason: "Push delivery failed." };
  }
}
