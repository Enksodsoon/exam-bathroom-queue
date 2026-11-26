import { sendNotification, setVapidDetails } from "web-push";
import type { ExamSession } from "@/lib/domain/types";
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

export async function sendNextStudentPushNotifications(
  sessionId: string,
  session: ExamSession,
  prevAlertSeq: number,
): Promise<void> {
  const alert = session.lastNextAlert;
  if (!alert || alert.seq <= prevAlertSeq) {
    return;
  }

  const subs = session.pushSubscriptions ?? [];
  if (subs.length === 0 || !ensureVapidConfigured()) {
    return;
  }

  const sexLabel = alert.sex === "M" ? "Male" : "Female";
  const payload = JSON.stringify({
    title: `ExamQ · Next ${sexLabel}`,
    body: `#${alert.studentNumber} is next in the ${sexLabel.toLowerCase()} queue.`,
    tag: `examq-next-${sessionId}-${alert.sex}`,
    url: `/s/${encodeURIComponent(sessionId)}`,
  });

  const expiredEndpoints: string[] = [];

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
      } catch (err) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
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
}
