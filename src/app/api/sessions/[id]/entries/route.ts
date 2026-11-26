import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  requireControllerKeyHeader,
  verifyActorAuth,
  verifyControllerKey,
} from "@/lib/api/http";
import { readJsonBody, validateSubmitEntryBody } from "@/lib/api/validation";
import { submitStudent, toSessionSnapshot } from "@/lib/domain";
import { sendNextStudentPushNotifications } from "@/lib/push/sendPush";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const input = validateSubmitEntryBody(body);
    const providedControllerKey =
      input.override === true ? requireControllerKeyHeader(request) : null;

    const store = getSessionStore();
    const {
      session,
      result: { entry, prevAlertSeq },
    } = await store.mutate(id, (current) => {
      if (providedControllerKey !== null) {
        verifyControllerKey(current.controllerKey, providedControllerKey);
      }
      const actor = verifyActorAuth(request, current);
      const nowMs = Date.now();
      const next = submitStudent(
        current,
        actor.role === "staff"
          ? {
              ...input,
              staffId: actor.staffId,
              submittedBy: undefined,
              override: false,
            }
          : {
              ...input,
              staffId: undefined,
              submittedBy: "Controller",
            },
        nowMs,
      );
      return {
        session: next.session,
        result: { entry: next.entry, prevAlertSeq: current.alertSeq },
      };
    });

    await sendNextStudentPushNotifications(id, session, prevAlertSeq);

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ entry, snapshot }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
