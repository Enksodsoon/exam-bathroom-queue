import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  verifyActorAuth,
} from "@/lib/api/http";
import { applyUndo, toSessionSnapshot } from "@/lib/domain";
import { sendNextStudentPushNotifications } from "@/lib/push/sendPush";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const store = getSessionStore();
    const { session, result: prevAlertSeq } = await store.mutate(
      id,
      (current) => {
        const actor = verifyActorAuth(request, current);
        const actorKey =
          actor.role === "controller"
            ? "controller"
            : `staff:${actor.staffId}`;
        const nextSession = applyUndo(
          current,
          {
            actorKey,
            isController: actor.role === "controller",
          },
          Date.now(),
        );
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
