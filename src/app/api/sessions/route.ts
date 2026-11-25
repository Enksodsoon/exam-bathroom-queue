import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { apiJson, handleApiError } from "@/lib/api/http";
import { readJsonBody } from "@/lib/api/validation";
import { createSession, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await readJsonBody(request, { allowEmpty: true });
    const store = getSessionStore();
    const nowMs = Date.now();
    const sessionId = crypto.randomBytes(9).toString("base64url");
    const controllerKey = crypto.randomBytes(24).toString("base64url");

    const session = createSession(nowMs, {
      id: sessionId,
      controllerKey,
    });
    const created = await store.create(session);
    const snapshot = toSessionSnapshot(created, nowMs);

    return apiJson(
      {
        sessionId: created.id,
        controllerKey: created.controllerKey,
        joinUrl: `/s/${created.id}`,
        controllerUrl: `/s/${created.id}?key=${encodeURIComponent(created.controllerKey)}`,
        snapshot,
      },
      201,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
