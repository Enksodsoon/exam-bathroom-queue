import type { NextRequest } from "next/server";
import {
  ApiHttpError,
  apiJson,
  handleApiError,
  verifyActorAuth,
} from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rateLimit";
import { readJsonBody } from "@/lib/api/validation";
import { sendTestPushNotification } from "@/lib/push/sendPush";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const limited = await enforceRateLimit(request, {
      bucket: "push-test",
      limit: 20,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const { id } = await context.params;
    const body = await readJsonBody(request);
    const endpoint =
      typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) {
      throw new ApiHttpError(400, "INVALID_INPUT", "endpoint is required");
    }

    const store = getSessionStore();
    const session = await store.get(id);
    if (!session) {
      throw new ApiHttpError(404, "SESSION_NOT_FOUND", "Session not found");
    }

    const actor = verifyActorAuth(request, session);
    const actorKey =
      actor.role === "controller" ? "controller" : `staff:${actor.staffId}`;

    const sub = (session.pushSubscriptions ?? []).find(
      (s) => s.endpoint === endpoint && s.actorKey === actorKey,
    );
    if (!sub) {
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Push subscription not registered for this session",
      );
    }

    const outcome = await sendTestPushNotification(id, sub);
    if (!outcome.sent) {
      return apiJson({ ok: false, error: outcome.reason ?? "Failed" }, 502);
    }

    return apiJson({ ok: true }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
