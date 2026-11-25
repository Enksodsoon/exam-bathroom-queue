import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  DomainError,
  type DomainErrorCode,
  type WindowStatus,
} from "@/lib/domain";
import { StorageError, type StorageErrorCode } from "@/lib/storage";

export class ApiHttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly windowStatus?: WindowStatus;
  public readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: {
      windowStatus?: WindowStatus;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.windowStatus = options?.windowStatus;
    this.details = options?.details;
    Object.setPrototypeOf(this, ApiHttpError.prototype);
  }
}

export function apiJson<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function mapDomainErrorStatus(code: DomainErrorCode): number {
  switch (code) {
    case "INVALID_INPUT":
      return 400;
    case "OUTSIDE_TIME_WINDOW":
    case "OVERRIDE_REQUIRED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "DUPLICATE_STUDENT":
    case "BATHROOM_OCCUPIED":
    case "INVALID_STATE":
      return 409;
  }
}

function mapStorageErrorStatus(code: StorageErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
    case "INVALID_SESSION_ID":
      return 404;
    case "ALREADY_EXISTS":
    case "CONFLICT":
      return 409;
    case "STORAGE_MISCONFIGURED":
    case "CORRUPT_DATA":
      return 500;
  }
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiHttpError) {
    return apiJson(
      {
        error: err.message,
        code: err.code,
        ...(err.windowStatus !== undefined
          ? { windowStatus: err.windowStatus }
          : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      err.status,
    );
  }

  if (err instanceof DomainError) {
    return apiJson(
      {
        error: err.message,
        code: err.code,
        ...(err.windowStatus !== undefined
          ? { windowStatus: err.windowStatus }
          : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      mapDomainErrorStatus(err.code),
    );
  }

  if (err instanceof StorageError) {
    return apiJson(
      {
        error: err.message,
        code: err.code,
      },
      mapStorageErrorStatus(err.code),
    );
  }

  return apiJson(
    {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    },
    500,
  );
}

export function requireControllerKeyHeader(request: Request): string {
  const headerValue = request.headers.get("x-controller-key");
  const trimmed = typeof headerValue === "string" ? headerValue.trim() : "";
  if (trimmed.length === 0) {
    throw new ApiHttpError(
      401,
      "UNAUTHORIZED",
      "Missing x-controller-key header",
    );
  }
  return trimmed;
}

export function isControllerKeyValid(
  expected: string,
  provided: string,
): boolean {
  if (!expected || !provided) {
    return false;
  }
  const expectedDigest = crypto
    .createHash("sha256")
    .update(expected, "utf8")
    .digest();
  const providedDigest = crypto
    .createHash("sha256")
    .update(provided, "utf8")
    .digest();

  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

export function verifyControllerKey(expected: string, provided: string): void {
  if (!isControllerKeyValid(expected, provided)) {
    throw new ApiHttpError(403, "UNAUTHORIZED", "Invalid controller key");
  }
}
