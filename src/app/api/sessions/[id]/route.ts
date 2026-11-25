import type { NextRequest } from "next/server";
import { ApiHttpError, apiJson, handleApiError } from "@/lib/api/http";
import { parseSinceVersion } from "@/lib/api/validation";
import { evaluateExamWindow, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sinceVersion = parseSinceVersion(
      request.nextUrl.searchParams.get("sinceVersion"),
    );

    const store = getSessionStore();
    const session = await store.get(id);
    if (!session) {
      throw new ApiHttpError(404, "NOT_FOUND", `Session '${id}' not found`);
    }

    const nowMs = Date.now();
    if (sinceVersion !== null && sinceVersion === session.version) {
      const { windowStatus, effectiveNowMs } = evaluateExamWindow(
        session.examConfig,
        nowMs,
      );
      return apiJson(
        {
          unchanged: true,
          version: session.version,
          serverNowMs: nowMs,
          effectiveNowMs,
          windowStatus,
        },
        200,
      );
    }

    const snapshot = toSessionSnapshot(session, nowMs);
    return apiJson(
      {
        unchanged: false,
        snapshot,
      },
      200,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
