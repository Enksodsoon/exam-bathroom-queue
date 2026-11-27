import type { NextRequest } from "next/server";
import {
  ApiHttpError,
  apiJson,
  handleApiError,
  verifyActorAuth,
} from "@/lib/api/http";
import { readJsonBody, validateEntryActionBody } from "@/lib/api/validation";
import { applyEntryAction, toSessionSnapshot } from "@/lib/domain";
import { sendNextStudentPushNotifications } from "@/lib/push/sendPush";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id, entryId } = await context.params;
    const body = await readJsonBody(request);
    const actionInput = validateEntryActionBody(body);

    const store = getSessionStore();
    const { session, result: prevAlertSeq } = await store.mutate(
      id,
      (current) => {
        const actor = verifyActorAuth(request, current);
        if (actor.role === "staff") {
          if (actionInput.action === "remove" || actionInput.override) {
            throw new ApiHttpError(
              403,
              "FORBIDDEN",
              "Only the exam controller can remove or override queue entries",
            );
          }
        }
        const actorKey =
          actor.role === "controller"
            ? "controller"
            : `staff:${actor.staffId}`;
        const nowMs = Date.now();
        const next = applyEntryAction(
          current,
          {
            entryId,
            action: actionInput.action,
            override: actionInput.override,
            actorKey,
          },
          nowMs,
        );
        return { session: next.session, result: current.alertSeq };
      },
    );

    await sendNextStudentPushNotifications(id, session, prevAlertSeq);

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ snapshot }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
