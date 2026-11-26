import type { NextRequest } from "next/server";
import {
  ApiHttpError,
  apiJson,
  handleApiError,
  verifyActorAuth,
} from "@/lib/api/http";
import { readJsonBody } from "@/lib/api/validation";
import { acknowledgeAlert, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const seq = body.seq;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      throw new ApiHttpError(
        400,
        "INVALID_INPUT",
        "seq must be a positive integer",
      );
    }

    const store = getSessionStore();
    const { session } = await store.mutate(id, (current) => {
      const actor = verifyActorAuth(request, current);
      const actorKey =
        actor.role === "controller" ? "controller" : `staff:${actor.staffId}`;
      const label =
        actor.role === "controller"
          ? "Controller"
          : (current.staff.find((s) => s.id === actor.staffId)?.label ??
            "Staff");

      const nextSession = acknowledgeAlert(
        current,
        { actorKey, label, seq },
        Date.now(),
      );
      return { session: nextSession, result: null };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson({ snapshot }, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
