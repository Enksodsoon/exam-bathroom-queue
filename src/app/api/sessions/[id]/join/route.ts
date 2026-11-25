import type { NextRequest } from "next/server";
import { apiJson, handleApiError } from "@/lib/api/http";
import { readJsonBody, validateJoinBody } from "@/lib/api/validation";
import { joinStaff, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const input = validateJoinBody(body);

    const store = getSessionStore();
    const { session, result: staff } = await store.mutate(id, (current) => {
      const nowMs = Date.now();
      const next = joinStaff(current, input, nowMs);
      return { session: next.session, result: next.staff };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson(
      {
        staffId: staff.id,
        label: staff.label,
        snapshot,
      },
      200,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
