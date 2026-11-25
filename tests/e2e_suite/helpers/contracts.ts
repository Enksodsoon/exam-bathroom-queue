export type Sex = 'M' | 'F';

export type EntryStatus = 'queued' | 'in_bathroom' | 'returned' | 'removed';

export type WindowStatus =
  | 'UNCONFIGURED'
  | 'BEFORE_START'
  | 'FIRST_30_MIN'
  | 'ALLOWED'
  | 'LAST_20_MIN'
  | 'AFTER_END';

export interface ExamConfig {
  startTimeMs: number;
  durationMinutes: number;
  clockOffsetMs?: number;
}

export interface QueueEntry {
  id: string;
  sex: Sex;
  studentNumber: string;
  status: EntryStatus;
  submittedBy: string;
  createdAt: number;
  enteredAt: number | null;
  returnedAt: number | null;
  override: boolean;
}

export interface StaffMember {
  id: string;
  label: string;
  joinedAt: number;
  lastSeenAt: number;
}

export interface AlertInfo {
  seq: number;
  sex: Sex;
  entryId: string;
  studentNumber: string;
  triggeredAt: number;
}

export interface SessionSnapshot {
  id: string;
  createdAt: number;
  version: number;
  clearedSeq: number;
  serverNowMs: number;
  effectiveNowMs: number;
  windowStatus: WindowStatus;
  examConfig: ExamConfig | null;
  entries: QueueEntry[];
  staff: StaffMember[];
  nextBySex: {
    M: string | null;
    F: string | null;
  };
  lastNextAlert: AlertInfo | null;
}

export interface HealthResponse {
  ok: boolean;
  storage: 'file' | 'upstash-redis';
  error?: string;
}

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

export interface ApiErrorBody {
  error: string;
  code?: string;
  windowStatus?: WindowStatus;
}

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;
