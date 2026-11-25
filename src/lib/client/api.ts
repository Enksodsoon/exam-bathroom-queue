import type {
  EntryAction,
  ExamConfig,
  QueueEntry,
  ReorderInput,
  SessionSnapshot,
  SubmitStudentInput,
  WindowStatus,
} from "@/lib/domain/types";

export interface CreateSessionResponse {
  sessionId: string;
  controllerKey: string;
  joinUrl: string;
  controllerUrl: string;
  snapshot: SessionSnapshot;
}

export type GetSessionResponse =
  | {
      unchanged: true;
      version: number;
      serverNowMs: number;
      effectiveNowMs: number;
      windowStatus: WindowStatus;
    }
  | {
      unchanged: false;
      snapshot: SessionSnapshot;
    };

export interface JoinSessionResponse {
  staffId: string;
  label: string;
  snapshot: SessionSnapshot;
}

export interface SnapshotResponse {
  snapshot: SessionSnapshot;
}

export interface SubmitEntryResponse {
  entry: QueueEntry;
  snapshot: SessionSnapshot;
}

export interface ApiErrorPayload {
  error?: string;
  code?: string;
  windowStatus?: WindowStatus;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
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
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.windowStatus = options?.windowStatus;
    this.details = options?.details;
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const payload =
      typeof parsed === "object" && parsed !== null
        ? (parsed as ApiErrorPayload)
        : {};
    throw new ApiClientError(
      response.status,
      typeof payload.code === "string" ? payload.code : "REQUEST_FAILED",
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`,
      {
        windowStatus: payload.windowStatus,
        details: payload.details,
      },
    );
  }

  if (parsed === null) {
    throw new ApiClientError(
      response.status,
      "INVALID_RESPONSE",
      "Server returned an invalid JSON response",
    );
  }

  return parsed as T;
}

export function createSession(): Promise<CreateSessionResponse> {
  return requestJson<CreateSessionResponse>("/api/sessions", {
    method: "POST",
    body: "{}",
  });
}

export function getSession(
  sessionId: string,
  sinceVersion?: number,
  signal?: AbortSignal,
): Promise<GetSessionResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const query =
    sinceVersion !== undefined
      ? `?sinceVersion=${encodeURIComponent(String(sinceVersion))}`
      : "";
  return requestJson<GetSessionResponse>(`/api/sessions/${encodedId}${query}`, {
    method: "GET",
    signal,
  });
}

export function joinSession(
  sessionId: string,
  label: string,
): Promise<JoinSessionResponse> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<JoinSessionResponse>(`/api/sessions/${encodedId}/join`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function updateConfig(
  sessionId: string,
  controllerKey: string,
  config: ExamConfig,
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const payload: ExamConfig = {
    startTimeMs: config.startTimeMs,
    durationMinutes: config.durationMinutes,
    ...(config.clockOffsetMs !== undefined
      ? { clockOffsetMs: config.clockOffsetMs }
      : {}),
  };

  return requestJson<SnapshotResponse>(`/api/sessions/${encodedId}/config`, {
    method: "PATCH",
    headers: {
      "x-controller-key": controllerKey,
    },
    body: JSON.stringify(payload),
  });
}

export function submitEntry(
  sessionId: string,
  input: SubmitStudentInput,
  controllerKey?: string,
): Promise<SubmitEntryResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const headers: Record<string, string> = {};
  if (controllerKey) {
    headers["x-controller-key"] = controllerKey;
  }

  return requestJson<SubmitEntryResponse>(
    `/api/sessions/${encodedId}/entries`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    },
  );
}

export function applyEntryAction(
  sessionId: string,
  controllerKey: string,
  entryId: string,
  action: EntryAction,
  options?: { override?: boolean },
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const encodedEntryId = encodeURIComponent(entryId);
  const body =
    options?.override !== undefined
      ? { action, override: options.override }
      : { action };

  return requestJson<SnapshotResponse>(
    `/api/sessions/${encodedId}/entries/${encodedEntryId}/action`,
    {
      method: "POST",
      headers: {
        "x-controller-key": controllerKey,
      },
      body: JSON.stringify(body),
    },
  );
}

export function reorderEntry(
  sessionId: string,
  controllerKey: string,
  input: ReorderInput,
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<SnapshotResponse>(`/api/sessions/${encodedId}/reorder`, {
    method: "POST",
    headers: {
      "x-controller-key": controllerKey,
    },
    body: JSON.stringify(input),
  });
}

export function clearSession(
  sessionId: string,
  controllerKey: string,
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<SnapshotResponse>(`/api/sessions/${encodedId}/clear`, {
    method: "POST",
    headers: {
      "x-controller-key": controllerKey,
    },
    body: "{}",
  });
}
