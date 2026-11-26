import {
  isValidExamBlockMinutes,
  MAX_BLOCK_MINUTES,
  MAX_VALID_DATE_MS,
  MS_PER_MINUTE,
  type EntryAction,
  type ExamConfig,
  type ReorderInput,
  type SubmitStudentInput,
} from "@/lib/domain";
import { ApiHttpError } from "./http";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_JSON_BODY_BYTES = 16_384;

export async function readJsonBody(
  request: Request,
  options?: { allowEmpty?: boolean },
): Promise<Record<string, unknown>> {
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    throw new ApiHttpError(400, "INVALID_INPUT", "Unable to read request body");
  }

  if (Buffer.byteLength(rawText, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new ApiHttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      "Request body exceeds 16KB limit",
    );
  }

  if (rawText.trim().length === 0) {
    if (options?.allowEmpty) {
      return {};
    }
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Request body must be a JSON object",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Malformed JSON request body",
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Request body must be a JSON object",
    );
  }

  return parsed;
}

export function parseSinceVersion(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }

  if (!/^-?\d+$/.test(raw)) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "sinceVersion must be an integer",
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "sinceVersion must be a safe integer",
    );
  }

  return parsed;
}

export function validateJoinBody(body: Record<string, unknown>): {
  label: string;
} {
  if (typeof body.label !== "string") {
    throw new ApiHttpError(400, "INVALID_INPUT", "label must be a string");
  }
  return { label: body.label };
}

export function validateConfigBody(body: Record<string, unknown>): ExamConfig {
  if (
    typeof body.startTimeMs !== "number" ||
    !Number.isFinite(body.startTimeMs)
  ) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "startTimeMs must be a finite number",
    );
  }

  if (Math.abs(body.startTimeMs) > MAX_VALID_DATE_MS) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "startTimeMs must be within valid Date range",
    );
  }

  if (
    typeof body.durationMinutes !== "number" ||
    !Number.isFinite(body.durationMinutes) ||
    !Number.isInteger(body.durationMinutes) ||
    body.durationMinutes < 1
  ) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "durationMinutes must be a whole integer >= 1",
    );
  }

  const endMs = body.startTimeMs + body.durationMinutes * MS_PER_MINUTE;
  if (!Number.isFinite(endMs) || Math.abs(endMs) > MAX_VALID_DATE_MS) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Exam end time must be within valid Date range",
    );
  }

  if (
    body.clockOffsetMs !== undefined &&
    (typeof body.clockOffsetMs !== "number" ||
      !Number.isFinite(body.clockOffsetMs) ||
      Math.abs(body.clockOffsetMs) > MAX_VALID_DATE_MS * 2)
  ) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "clockOffsetMs must be a finite number within valid Date offset range",
    );
  }

  const { firstBlockMinutes, lastBlockMinutes } = body;
  if (
    (firstBlockMinutes !== undefined && !isValidExamBlockMinutes(firstBlockMinutes)) ||
    (lastBlockMinutes !== undefined && !isValidExamBlockMinutes(lastBlockMinutes))
  ) {
    throw new ApiHttpError(400, "INVALID_INPUT", `Block lengths must be whole minutes from 0 to ${MAX_BLOCK_MINUTES}`);
  }

  return {
    ...(firstBlockMinutes !== undefined ? { firstBlockMinutes } : {}),
    ...(lastBlockMinutes !== undefined ? { lastBlockMinutes } : {}),
    startTimeMs: body.startTimeMs,
    durationMinutes: body.durationMinutes,
    ...(body.clockOffsetMs !== undefined
      ? { clockOffsetMs: body.clockOffsetMs }
      : {}),
  };
}

export function validateSubmitEntryBody(
  body: Record<string, unknown>,
): SubmitStudentInput {
  if (body.sex !== "M" && body.sex !== "F") {
    throw new ApiHttpError(400, "INVALID_INPUT", "sex must be 'M' or 'F'");
  }

  if (typeof body.studentNumber !== "string") {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "studentNumber must be a string",
    );
  }

  if (body.staffId !== undefined && typeof body.staffId !== "string") {
    throw new ApiHttpError(400, "INVALID_INPUT", "staffId must be a string");
  }

  if (body.submittedBy !== undefined && typeof body.submittedBy !== "string") {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "submittedBy must be a string",
    );
  }

  if (body.override !== undefined && typeof body.override !== "boolean") {
    throw new ApiHttpError(400, "INVALID_INPUT", "override must be a boolean");
  }

  return {
    sex: body.sex,
    studentNumber: body.studentNumber,
    ...(body.staffId !== undefined ? { staffId: body.staffId } : {}),
    ...(body.submittedBy !== undefined
      ? { submittedBy: body.submittedBy }
      : {}),
    ...(body.override !== undefined ? { override: body.override } : {}),
  };
}

export function validateEntryActionBody(body: Record<string, unknown>): {
  action: EntryAction;
  override?: boolean;
} {
  if (
    body.action !== "enter" &&
    body.action !== "return" &&
    body.action !== "remove"
  ) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "action must be 'enter', 'return', or 'remove'",
    );
  }

  if (body.override !== undefined && typeof body.override !== "boolean") {
    throw new ApiHttpError(400, "INVALID_INPUT", "override must be a boolean");
  }

  return {
    action: body.action,
    ...(body.override !== undefined ? { override: body.override } : {}),
  };
}

export function validateReorderBody(
  body: Record<string, unknown>,
): ReorderInput {
  if (typeof body.entryId !== "string" || body.entryId.trim().length === 0) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "entryId must be a non-empty string",
    );
  }

  const hasDirection = body.direction !== undefined;
  const hasTargetIndex = body.targetIndex !== undefined;

  if (hasDirection && hasTargetIndex) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Provide either direction or targetIndex, not both",
    );
  }

  if (!hasDirection && !hasTargetIndex) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Must provide direction or targetIndex",
    );
  }

  if (hasDirection) {
    if (body.direction !== "up" && body.direction !== "down") {
      throw new ApiHttpError(
        400,
        "INVALID_INPUT",
        "direction must be 'up' or 'down'",
      );
    }
    return {
      entryId: body.entryId,
      direction: body.direction,
    };
  }

  if (
    typeof body.targetIndex !== "number" ||
    !Number.isInteger(body.targetIndex)
  ) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "targetIndex must be an integer",
    );
  }

  return {
    entryId: body.entryId,
    targetIndex: body.targetIndex,
  };
}
