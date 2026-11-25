import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  requireControllerKeyHeader,
  verifyControllerKey,
} from "@/lib/api/http";
import { readJsonBody, validateSubmitEntryBody } from "@/lib/api/validation";
import { submitStudent, toSessionSnapshot } from "@/lib/domain";
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
    const providedKey =
      input.override === true ? requireControllerKeyHeader(request) : null;

    const store = getSessionStore();
    const { session, result: entry } = await store.mutate(id, (current) => {
      if (providedKey !== null) {
        verifyControllerKey(current.controllerKey, providedKey);
      }
      const nowMs = Date.now();
      const next = submitStudent(current, input, nowMs);
      return { session: next.session, result: next.entry };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ entry, snapshot }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
