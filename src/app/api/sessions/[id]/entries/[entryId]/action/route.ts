import type { NextRequest } from "next/server";
import {
  apiJson,
  handleApiError,
  requireControllerKeyHeader,
  verifyControllerKey,
} from "@/lib/api/http";
import { readJsonBody, validateEntryActionBody } from "@/lib/api/validation";
import { applyEntryAction, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id, entryId } = await context.params;
    const providedKey = requireControllerKeyHeader(request);
    const body = await readJsonBody(request);
    const actionInput = validateEntryActionBody(body);

    const store = getSessionStore();
    const { session } = await store.mutate(id, (current) => {
      verifyControllerKey(current.controllerKey, providedKey);
      const nowMs = Date.now();
      const next = applyEntryAction(
        current,
        {
          entryId,
          action: actionInput.action,
          override: actionInput.override,
        },
        nowMs,
      );
      return { session: next.session, result: next.entry };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ snapshot }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
