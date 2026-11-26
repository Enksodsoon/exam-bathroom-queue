import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  requireControllerKeyHeader,
  verifyControllerKey,
} from "@/lib/api/http";
import { readJsonBody, validateReorderBody } from "@/lib/api/validation";
import { reorderQueuedEntry, toSessionSnapshot } from "@/lib/domain";
import { sendNextStudentPushNotifications } from "@/lib/push/sendPush";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const providedKey = requireControllerKeyHeader(request);
    const body = await readJsonBody(request);
    const reorderInput = validateReorderBody(body);

    const store = getSessionStore();
    const { session, result: prevAlertSeq } = await store.mutate(
      id,
      (current) => {
        verifyControllerKey(current.controllerKey, providedKey);
        const nowMs = Date.now();
        const nextSession = reorderQueuedEntry(current, reorderInput, nowMs);
        return { session: nextSession, result: current.alertSeq };
      },
    );

    await sendNextStudentPushNotifications(id, session, prevAlertSeq);

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ snapshot }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
