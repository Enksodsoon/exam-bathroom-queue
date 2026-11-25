import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  requireControllerKeyHeader,
  verifyControllerKey,
} from "@/lib/api/http";
import { readJsonBody, validateConfigBody } from "@/lib/api/validation";
import { toSessionSnapshot, updateExamConfig } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const providedKey = requireControllerKeyHeader(request);
    const body = await readJsonBody(request);
    const configInput = validateConfigBody(body);

    const store = getSessionStore();
    const { session } = await store.mutate(id, (current) => {
      verifyControllerKey(current.controllerKey, providedKey);
      const nowMs = Date.now();
      const nextSession = updateExamConfig(current, configInput, nowMs);
      return { session: nextSession, result: null };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ snapshot }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
