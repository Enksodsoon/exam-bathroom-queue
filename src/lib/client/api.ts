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
  staffToken?: string;
  snapshot: SessionSnapshot;
}

export interface RequestAuth {
  controllerKey?: string | null;
  staffToken?: string | null;
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

const DEFAULT_GET_TIMEOUT_MS = 8_000;
const DEFAULT_MUTATION_TIMEOUT_MS = 10_000;

async function requestJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const timeoutMs =
    init?.timeoutMs ??
    (method === "GET" ? DEFAULT_GET_TIMEOUT_MS : DEFAULT_MUTATION_TIMEOUT_MS);

  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const callerSignal = init?.signal;
  const onCallerAbort = () => timeoutController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException("Aborted", "AbortError");
    }
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: timeoutController.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (timedOut) {
      throw new ApiClientError(
        408,
        "TIMEOUT",
        "Request timed out. Please check your connection.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }

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
  auth?: RequestAuth,
): Promise<GetSessionResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const query =
    sinceVersion !== undefined
      ? `?sinceVersion=${encodeURIComponent(String(sinceVersion))}`
      : "";
  const headers: Record<string, string> = {};
  if (auth?.controllerKey) {
    headers["x-controller-key"] = auth.controllerKey;
  } else if (auth?.staffToken) {
    headers["x-staff-token"] = auth.staffToken;
  }
  return requestJson<GetSessionResponse>(`/api/sessions/${encodedId}${query}`, {
    method: "GET",
    headers,
    signal,
  });
}

export function joinSession(
  sessionId: string,
  label: string,
  inviteCode?: string | null,
): Promise<JoinSessionResponse> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<JoinSessionResponse>(`/api/sessions/${encodedId}/join`, {
    method: "POST",
    body: JSON.stringify({
      label,
      ...(inviteCode ? { inviteCode } : {}),
    }),
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
    ...(config.firstBlockMinutes !== undefined ? { firstBlockMinutes: config.firstBlockMinutes } : {}),
    ...(config.lastBlockMinutes !== undefined ? { lastBlockMinutes: config.lastBlockMinutes } : {}),
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
  controllerKeyOrAuth?: string | RequestAuth,
): Promise<SubmitEntryResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const headers: Record<string, string> = {};
  if (typeof controllerKeyOrAuth === "string") {
    headers["x-controller-key"] = controllerKeyOrAuth;
  } else if (controllerKeyOrAuth?.controllerKey) {
    headers["x-controller-key"] = controllerKeyOrAuth.controllerKey;
  } else if (controllerKeyOrAuth?.staffToken) {
    headers["x-staff-token"] = controllerKeyOrAuth.staffToken;
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
  auth: string | RequestAuth,
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

  const headers: Record<string, string> = {};
  if (typeof auth === "string") {
    headers["x-controller-key"] = auth;
  } else if (auth.controllerKey) {
    headers["x-controller-key"] = auth.controllerKey;
  } else if (auth.staffToken) {
    headers["x-staff-token"] = auth.staffToken;
  }

  return requestJson<SnapshotResponse>(
    `/api/sessions/${encodedId}/entries/${encodedEntryId}/action`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

export function postUndo(
  sessionId: string,
  auth: RequestAuth,
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const headers: Record<string, string> = {};
  if (auth.controllerKey) {
    headers["x-controller-key"] = auth.controllerKey;
  } else if (auth.staffToken) {
    headers["x-staff-token"] = auth.staffToken;
  }

  return requestJson<SnapshotResponse>(`/api/sessions/${encodedId}/undo`, {
    method: "POST",
    headers,
    body: "{}",
  });
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
  options?: { force?: boolean },
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<SnapshotResponse>(`/api/sessions/${encodedId}/clear`, {
    method: "POST",
    headers: {
      "x-controller-key": controllerKey,
    },
    body: JSON.stringify(options?.force ? { force: true } : {}),
  });
}

export function rotateInvite(
  sessionId: string,
  controllerKey: string,
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<SnapshotResponse>(
    `/api/sessions/${encodedId}/rotate-invite`,
    {
      method: "POST",
      headers: {
        "x-controller-key": controllerKey,
      },
      body: "{}",
    },
  );
}

export function acknowledgeAlert(
  sessionId: string,
  seq: number,
  auth: RequestAuth,
): Promise<SnapshotResponse> {
  const encodedId = encodeURIComponent(sessionId);
  const headers: Record<string, string> = {};
  if (auth.controllerKey) {
    headers["x-controller-key"] = auth.controllerKey;
  } else if (auth.staffToken) {
    headers["x-staff-token"] = auth.staffToken;
  }
  return requestJson<SnapshotResponse>(`/api/sessions/${encodedId}/ack`, {
    method: "POST",
    headers,
    body: JSON.stringify({ seq }),
  });
}

export function deleteSession(
  sessionId: string,
  controllerKey: string,
): Promise<{ ok: true }> {
  const encodedId = encodeURIComponent(sessionId);
  return requestJson<{ ok: true }>(`/api/sessions/${encodedId}`, {
    method: "DELETE",
    headers: {
      "x-controller-key": controllerKey,
    },
  });
}
