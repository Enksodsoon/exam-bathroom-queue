import type { NextRequest } from "next/server";
import {
  ApiHttpError,
  apiJson,
  handleApiError,
  isControllerKeyValid,
} from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rateLimit";
import { readJsonBody, validateJoinBody } from "@/lib/api/validation";
import { joinStaff, toSessionSnapshot } from "@/lib/domain";
import { getSessionStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const limited = await enforceRateLimit(request, {
      bucket: "join-session",
      limit: 60,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const { id } = await context.params;
    const body = await readJsonBody(request);
    const input = validateJoinBody(body);
    const providedInvite =
      typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";

    const store = getSessionStore();
    const { session, result } = await store.mutate(id, (current) => {
      if (
        current.inviteCode &&
        (!providedInvite ||
          !isControllerKeyValid(current.inviteCode, providedInvite))
      ) {
        throw new ApiHttpError(
          403,
          "INVITE_INVALID",
          "Invite link has expired or been rotated. Please scan the latest QR code.",
        );
      }
      const nowMs = Date.now();
      const next = joinStaff(current, input, nowMs);
      return {
        session: next.session,
        result: { staff: next.staff, staffToken: next.staffToken },
      };
    });

    const snapshot = toSessionSnapshot(session, Date.now());
    return apiJson(
      {
        staffId: result.staff.id,
        label: result.staff.label,
        staffToken: result.staffToken,
        snapshot,
      },
      200,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
