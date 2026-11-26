import type { NextRequest } from "next/server";
import {
  ApiHttpError,
  apiJson,
  handleApiError,
  verifyActorAuth,
} from "@/lib/api/http";
import { readJsonBody } from "@/lib/api/validation";
import {
  removePushSubscription,
  upsertPushSubscription,
} from "@/lib/domain/queue";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

function parseSubscriptionBody(body: Record<string, unknown>): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const endpoint =
    typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint || !endpoint.startsWith("https://")) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Push subscription endpoint must be a valid https URL",
    );
  }

  const rawKeys = body.keys;
  if (typeof rawKeys !== "object" || rawKeys === null) {
    throw new ApiHttpError(400, "INVALID_INPUT", "Push keys are required");
  }
  const p256dh =
    typeof (rawKeys as { p256dh?: unknown }).p256dh === "string"
      ? (rawKeys as { p256dh: string }).p256dh.trim()
      : "";
  const auth =
    typeof (rawKeys as { auth?: unknown }).auth === "string"
      ? (rawKeys as { auth: string }).auth.trim()
      : "";

  if (!p256dh || !auth) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Push keys p256dh and auth are required",
    );
  }

  return { endpoint, keys: { p256dh, auth } };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const sub = parseSubscriptionBody(body);

    const store = getSessionStore();
    await store.mutate(id, (current) => {
      const actor = verifyActorAuth(request, current);
      const actorKey =
        actor.role === "controller" ? "controller" : `staff:${actor.staffId}`;
      const nextSession = upsertPushSubscription(
        current,
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
          actorKey,
        },
        Date.now(),
      );
      return { session: nextSession, result: null };
    });

    return apiJson({ ok: true }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const endpoint =
      typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) {
      throw new ApiHttpError(400, "INVALID_INPUT", "endpoint is required");
    }

    const store = getSessionStore();
    await store.mutate(id, (current) => {
      verifyActorAuth(request, current);
      const nextSession = removePushSubscription(current, endpoint);
      return { session: nextSession, result: null };
    });

    return apiJson({ ok: true }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
