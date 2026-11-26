import {
  DomainError,
  type ExamConfig,
  type ExamWindowBounds,
  type WindowEvaluation,
} from "./types";

export const MS_PER_MINUTE = 60_000;
export const FIRST_BLOCK_MINUTES = 30;
export const LAST_BLOCK_MINUTES = 20;
export const FIRST_BLOCK_MS = FIRST_BLOCK_MINUTES * MS_PER_MINUTE;
export const LAST_BLOCK_MS = LAST_BLOCK_MINUTES * MS_PER_MINUTE;
export const MAX_BLOCK_MINUTES = 1440;

export function isValidExamBlockMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= 0 && value <= MAX_BLOCK_MINUTES;
}

export function getExamBlockMinutes(
  config?: Pick<ExamConfig, "firstBlockMinutes" | "lastBlockMinutes"> | null,
) {
  return {
    first: config?.firstBlockMinutes ?? FIRST_BLOCK_MINUTES,
    last: config?.lastBlockMinutes ?? LAST_BLOCK_MINUTES,
  };
}

export const MAX_VALID_DATE_MS = 8.64e15;

export function getExamWindowBounds(config: ExamConfig): ExamWindowBounds {
  if (
    !config ||
    typeof config.startTimeMs !== "number" ||
    !Number.isFinite(config.startTimeMs)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Exam startTimeMs must be a finite number",
    );
  }

  if (Math.abs(config.startTimeMs) > MAX_VALID_DATE_MS) {
    throw new DomainError(
      "INVALID_INPUT",
      "Exam startTimeMs must be within valid Date range",
    );
  }

  if (
    typeof config.durationMinutes !== "number" ||
    !Number.isFinite(config.durationMinutes) ||
    config.durationMinutes < 1
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Exam durationMinutes must be a finite number >= 1",
    );
  }

  for (const value of [config.firstBlockMinutes, config.lastBlockMinutes]) {
    if (value !== undefined && !isValidExamBlockMinutes(value)) {
      throw new DomainError("INVALID_INPUT", `Block lengths must be whole minutes from 0 to ${MAX_BLOCK_MINUTES}`);
    }
  }

  const { first, last } = getExamBlockMinutes(config);
  const startMs = config.startTimeMs;
  const endMs = startMs + config.durationMinutes * MS_PER_MINUTE;
  const allowStartMs = startMs + first * MS_PER_MINUTE;
  const allowEndMs = endMs - last * MS_PER_MINUTE;

  if (
    !Number.isFinite(endMs) ||
    !Number.isFinite(allowStartMs) ||
    !Number.isFinite(allowEndMs)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Exam window bounds overflow finite number range",
    );
  }

  if (Math.abs(endMs) > MAX_VALID_DATE_MS) {
    throw new DomainError(
      "INVALID_INPUT",
      "Exam end time must be within valid Date range",
    );
  }

  return {
    startMs,
    endMs,
    allowStartMs,
    allowEndMs,
  };
}

export function evaluateExamWindow(
  config: ExamConfig | null,
  nowMs: number,
): WindowEvaluation {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new DomainError("INVALID_INPUT", "nowMs must be a finite number");
  }

  if (Math.abs(nowMs) > MAX_VALID_DATE_MS) {
    throw new DomainError(
      "INVALID_INPUT",
      "nowMs must be within valid Date range",
    );
  }

  if (!config) {
    return {
      windowStatus: "UNCONFIGURED",
      effectiveNowMs: nowMs,
    };
  }

  const offset = config.clockOffsetMs ?? 0;
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    throw new DomainError(
      "INVALID_INPUT",
      "clockOffsetMs must be a finite number",
    );
  }

  const { startMs, endMs, allowStartMs, allowEndMs } =
    getExamWindowBounds(config);
  const effectiveNowMs = nowMs + offset;

  if (
    !Number.isFinite(effectiveNowMs) ||
    Math.abs(effectiveNowMs) > MAX_VALID_DATE_MS
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "effectiveNowMs must be within valid Date range",
    );
  }

  if (effectiveNowMs < startMs) {
    return { windowStatus: "BEFORE_START", effectiveNowMs };
  }
  if (effectiveNowMs >= endMs) {
    return { windowStatus: "AFTER_END", effectiveNowMs };
  }
  if (effectiveNowMs < allowStartMs) {
    return { windowStatus: "FIRST_30_MIN", effectiveNowMs };
  }
  if (effectiveNowMs >= allowEndMs) {
    return { windowStatus: "LAST_20_MIN", effectiveNowMs };
  }

  return { windowStatus: "ALLOWED", effectiveNowMs };
}
