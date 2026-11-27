import { MAX_VALID_DATE_MS, MS_PER_MINUTE, type ExamSession } from "@/lib/domain";

export type StorageBackend = "file" | "upstash-redis";

export interface MutateResult<T> {
  session: ExamSession;
  result: T;
}

export type SessionMutator<T> = (current: ExamSession) => MutateResult<T>;

export type StorageErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "INVALID_SESSION_ID"
  | "CONFLICT"
  | "STORAGE_MISCONFIGURED"
  | "CORRUPT_DATA";

export class StorageError extends Error {
  public readonly code: StorageErrorCode;

  constructor(
    code: StorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "StorageError";
    this.code = code;
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

export interface SessionStore {
  readonly backendName: StorageBackend;
  ping(): Promise<void>;
  create(session: ExamSession): Promise<ExamSession>;
  get(sessionId: string): Promise<ExamSession | null>;
  mutate<T>(
    sessionId: string,
    mutator: SessionMutator<T>,
  ): Promise<MutateResult<T>>;
  delete(sessionId: string): Promise<boolean>;
}

export interface StorageHealth {
  ok: boolean;
  storage: StorageBackend;
  error?: string;
}

export const SESSION_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function assertValidSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || !SESSION_ID_REGEX.test(sessionId)) {
    throw new StorageError(
      "INVALID_SESSION_ID",
      "Session ID must match /^[A-Za-z0-9_-]{1,64}$/",
    );
  }
  return sessionId;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const VALID_ENTRY_STATUSES = new Set([
  "queued",
  "in_bathroom",
  "returned",
  "removed",
]);

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_VALID_DATE_MS
  );
}

export function parseStoredSession(raw: unknown): ExamSession {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StorageError("CORRUPT_DATA", "Stored session JSON is invalid", {
        cause: err,
      });
    }
  }

  if (!isPlainObject(parsed)) {
    throw new StorageError("CORRUPT_DATA", "Stored session must be an object");
  }

  if (
    typeof parsed.id !== "string" ||
    !SESSION_ID_REGEX.test(parsed.id) ||
    typeof parsed.controllerKey !== "string" ||
    parsed.controllerKey.length === 0 ||
    !isValidTimestamp(parsed.createdAt) ||
    typeof parsed.version !== "number" ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 1 ||
    typeof parsed.clearedSeq !== "number" ||
    !Number.isInteger(parsed.clearedSeq) ||
    parsed.clearedSeq < 0 ||
    typeof parsed.alertSeq !== "number" ||
    !Number.isInteger(parsed.alertSeq) ||
    parsed.alertSeq < 0 ||
    !Array.isArray(parsed.entries) ||
    !Array.isArray(parsed.staff) ||
    !isPlainObject(parsed.nextBySex)
  ) {
    throw new StorageError(
      "CORRUPT_DATA",
      "Stored session is missing required fields",
    );
  }

  const nextM = parsed.nextBySex.M;
  const nextF = parsed.nextBySex.F;
  if (
    (nextM !== null && typeof nextM !== "string") ||
    (nextF !== null && typeof nextF !== "string")
  ) {
    throw new StorageError("CORRUPT_DATA", "Stored nextBySex field is invalid");
  }

  if (parsed.examConfig !== null) {
    if (
      !isPlainObject(parsed.examConfig) ||
      !isValidTimestamp(parsed.examConfig.startTimeMs) ||
      typeof parsed.examConfig.durationMinutes !== "number" ||
      !Number.isFinite(parsed.examConfig.durationMinutes) ||
      parsed.examConfig.durationMinutes < 1
    ) {
      throw new StorageError("CORRUPT_DATA", "Stored examConfig is invalid");
    }
    const endMs =
      parsed.examConfig.startTimeMs +
      parsed.examConfig.durationMinutes * MS_PER_MINUTE;
    if (!isValidTimestamp(endMs)) {
      throw new StorageError(
        "CORRUPT_DATA",
        "Stored examConfig end time is out of range",
      );
    }
    if (
      parsed.examConfig.clockOffsetMs !== undefined &&
      (typeof parsed.examConfig.clockOffsetMs !== "number" ||
        !Number.isFinite(parsed.examConfig.clockOffsetMs) ||
        Math.abs(parsed.examConfig.clockOffsetMs) > MAX_VALID_DATE_MS * 2)
    ) {
      throw new StorageError(
        "CORRUPT_DATA",
        "Stored examConfig.clockOffsetMs is invalid",
      );
    }
  }

  for (const entry of parsed.entries) {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      entry.id.trim().length === 0 ||
      (entry.sex !== "M" && entry.sex !== "F") ||
      typeof entry.studentNumber !== "string" ||
      entry.studentNumber.trim().length === 0 ||
      typeof entry.status !== "string" ||
      !VALID_ENTRY_STATUSES.has(entry.status) ||
      typeof entry.submittedBy !== "string" ||
      !isValidTimestamp(entry.createdAt) ||
      (entry.enteredAt !== null && !isValidTimestamp(entry.enteredAt)) ||
      (entry.returnedAt !== null && !isValidTimestamp(entry.returnedAt)) ||
      typeof entry.override !== "boolean"
    ) {
      throw new StorageError("CORRUPT_DATA", "Stored entry item is invalid");
    }
  }

  for (const member of parsed.staff) {
    if (
      !isPlainObject(member) ||
      typeof member.id !== "string" ||
      member.id.trim().length === 0 ||
      typeof member.label !== "string" ||
      member.label.trim().length === 0 ||
      !isValidTimestamp(member.joinedAt) ||
      !isValidTimestamp(member.lastSeenAt)
    ) {
      throw new StorageError("CORRUPT_DATA", "Stored staff item is invalid");
    }
  }

  if (parsed.lastNextAlert !== null) {
    if (
      !isPlainObject(parsed.lastNextAlert) ||
      typeof parsed.lastNextAlert.seq !== "number" ||
      !Number.isInteger(parsed.lastNextAlert.seq) ||
      parsed.lastNextAlert.seq < 1 ||
      (parsed.lastNextAlert.sex !== "M" &&
        parsed.lastNextAlert.sex !== "F") ||
      typeof parsed.lastNextAlert.entryId !== "string" ||
      parsed.lastNextAlert.entryId.trim().length === 0 ||
      typeof parsed.lastNextAlert.studentNumber !== "string" ||
      parsed.lastNextAlert.studentNumber.trim().length === 0 ||
      !isValidTimestamp(parsed.lastNextAlert.triggeredAt)
    ) {
      throw new StorageError("CORRUPT_DATA", "Stored lastNextAlert is invalid");
    }
  }

  return parsed as unknown as ExamSession;
}
