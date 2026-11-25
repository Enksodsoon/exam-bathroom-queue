import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  requireControllerKeyHeader,
  verifyControllerKey,
} from "@/lib/api/http";
import { readJsonBody } from "@/lib/api/validation";
import { clearSession, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const providedKey = requireControllerKeyHeader(request);
    await readJsonBody(request, { allowEmpty: true });

    const store = getSessionStore();
    const { session } = await store.mutate(id, (current) => {
      verifyControllerKey(current.controllerKey, providedKey);
      const nowMs = Date.now();
      const nextSession = clearSession(current, nowMs);
      return { session: nextSession, result: null };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ snapshot }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
