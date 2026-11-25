import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  ApiErrorBody,
  CreateSessionResponse,
  ExamConfig,
  GetSessionResponse,
  HealthResponse,
  JoinSessionResponse,
  Sex,
  SnapshotResponse,
  SubmitEntryResponse,
} from './contracts';

export interface ApiCallResult<T> {
  status: number;
  ok: boolean;
  body: T;
  rawText: string;
  headers: Record<string, string>;
}

async function parseResponse<T>(res: APIResponse): Promise<ApiCallResult<T>> {
  const rawText = await res.text();
  let parsed: unknown = null;
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }
  return {
    status: res.status(),
    ok: res.ok(),
    body: parsed as T,
    rawText,
    headers: res.headers(),
  };
}

export class ExamQApiClient {
  constructor(private readonly request: APIRequestContext) {}

  async health(): Promise<ApiCallResult<HealthResponse & ApiErrorBody>> {
    const res = await this.request.get('/api/health');
    return parseResponse(res);
  }

  async createSession(
    rawPayload?: string | Record<string, unknown>,
  ): Promise<ApiCallResult<CreateSessionResponse & ApiErrorBody>> {
    const opts: Parameters<APIRequestContext['post']>[1] =
      typeof rawPayload === 'string'
        ? {
            data: rawPayload,
            headers: { 'content-type': 'application/json' },
          }
        : rawPayload
          ? { data: rawPayload }
          : {};
    const res = await this.request.post('/api/sessions', opts);
    return parseResponse(res);
  }

  async getSnapshot(
    sessionId: string,
    sinceVersion?: number | string,
  ): Promise<ApiCallResult<GetSessionResponse & ApiErrorBody>> {
    const qs =
      sinceVersion !== undefined
        ? `?sinceVersion=${encodeURIComponent(String(sinceVersion))}`
        : '';
    const res = await this.request.get(
      `/api/sessions/${encodeURIComponent(sessionId)}${qs}`,
    );
    return parseResponse(res);
  }

  async joinStaff(
    sessionId: string,
    payload: { label: unknown } | string,
  ): Promise<ApiCallResult<JoinSessionResponse & ApiErrorBody>> {
    const opts: Parameters<APIRequestContext['post']>[1] =
      typeof payload === 'string'
        ? {
            data: payload,
            headers: { 'content-type': 'application/json' },
          }
        : { data: payload };
    const res = await this.request.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/join`,
      opts,
    );
    return parseResponse(res);
  }

  async patchConfig(
    sessionId: string,
    controllerKey: string | null,
    config: Partial<ExamConfig> | Record<string, unknown> | string,
  ): Promise<ApiCallResult<SnapshotResponse & ApiErrorBody>> {
    const headers: Record<string, string> = {};
    if (controllerKey !== null) {
      headers['x-controller-key'] = controllerKey;
    }
    if (typeof config === 'string') {
      headers['content-type'] = 'application/json';
    }
    const res = await this.request.patch(
      `/api/sessions/${encodeURIComponent(sessionId)}/config`,
      {
        headers,
        data: config,
      },
    );
    return parseResponse(res);
  }

  async submitEntry(
    sessionId: string,
    body: {
      sex: Sex | string | null;
      studentNumber: string | null;
      staffId?: string;
      submittedBy?: string;
      override?: boolean;
    },
    controllerKey?: string | null,
  ): Promise<ApiCallResult<SubmitEntryResponse & ApiErrorBody>> {
    const headers: Record<string, string> = {};
    if (controllerKey) {
      headers['x-controller-key'] = controllerKey;
    }
    const res = await this.request.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/entries`,
      { headers, data: body },
    );
    return parseResponse(res);
  }

  async submitRawEntry(
    sessionId: string,
    rawBody: string,
    controllerKey?: string | null,
  ): Promise<ApiCallResult<SubmitEntryResponse & ApiErrorBody>> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (controllerKey) {
      headers['x-controller-key'] = controllerKey;
    }
    const res = await this.request.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/entries`,
      { headers, data: rawBody },
    );
    return parseResponse(res);
  }

  async entryAction(
    sessionId: string,
    entryId: string,
    controllerKey: string | null,
    body: { action: 'enter' | 'return' | 'remove' | string; override?: boolean },
  ): Promise<ApiCallResult<SnapshotResponse & ApiErrorBody>> {
    const headers: Record<string, string> = {};
    if (controllerKey !== null) {
      headers['x-controller-key'] = controllerKey;
    }
    const res = await this.request.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/action`,
      { headers, data: body },
    );
    return parseResponse(res);
  }

  async reorder(
    sessionId: string,
    controllerKey: string | null,
    body:
      | { entryId: string; targetIndex: number }
      | { entryId: string; direction: 'up' | 'down' }
      | Record<string, unknown>,
  ): Promise<ApiCallResult<SnapshotResponse & ApiErrorBody>> {
    const headers: Record<string, string> = {};
    if (controllerKey !== null) {
      headers['x-controller-key'] = controllerKey;
    }
    const res = await this.request.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/reorder`,
      { headers, data: body },
    );
    return parseResponse(res);
  }

  async clear(
    sessionId: string,
    controllerKey: string | null,
  ): Promise<ApiCallResult<SnapshotResponse & ApiErrorBody>> {
    const headers: Record<string, string> = {};
    if (controllerKey !== null) {
      headers['x-controller-key'] = controllerKey;
    }
    const res = await this.request.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/clear`,
      { headers },
    );
    return parseResponse(res);
  }

  async rawGet(path: string): Promise<ApiCallResult<unknown>> {
    const res = await this.request.get(path);
    return parseResponse(res);
  }
}

export function allowedWindowConfig(
  nowMs: number = Date.now(),
  durationMinutes = 120,
): ExamConfig {
  return {
    startTimeMs: nowMs - 45 * 60_000,
    durationMinutes,
    clockOffsetMs: 0,
  };
}

export async function createConfiguredSession(
  api: ExamQApiClient,
  options?: {
    durationMinutes?: number;
    clockOffsetMs?: number;
    startTimeMs?: number;
  },
): Promise<CreateSessionResponse> {
  const created = await api.createSession();
  if (created.status !== 201) {
    throw new Error(
      `Failed to create session: HTTP ${created.status} ${created.rawText}`,
    );
  }
  const baseNow = created.body.snapshot.serverNowMs || Date.now();
  const cfg: ExamConfig = {
    startTimeMs: options?.startTimeMs ?? baseNow - 45 * 60_000,
    durationMinutes: options?.durationMinutes ?? 120,
    clockOffsetMs: options?.clockOffsetMs ?? 0,
  };
  const patched = await api.patchConfig(
    created.body.sessionId,
    created.body.controllerKey,
    cfg,
  );
  if (patched.status !== 200) {
    throw new Error(
      `Failed to configure session: HTTP ${patched.status} ${patched.rawText}`,
    );
  }
  return {
    ...created.body,
    snapshot: patched.body.snapshot,
  };
}
