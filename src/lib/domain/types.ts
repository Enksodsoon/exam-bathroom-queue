export type Sex = "M" | "F";

export type EntryStatus = "queued" | "in_bathroom" | "returned" | "removed";

// Keep the historical wire names for opening/closing blocks; their lengths are configurable.
export type WindowStatus =
  | "UNCONFIGURED"
  | "BEFORE_START"
  | "FIRST_30_MIN"
  | "ALLOWED"
  | "LAST_20_MIN"
  | "AFTER_END";

export interface ExamConfig {
  startTimeMs: number;
  durationMinutes: number;
  clockOffsetMs?: number;
  firstBlockMinutes?: number;
  lastBlockMinutes?: number;
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

export interface AlertAcknowledgment {
  actorKey: string;
  label: string;
  at: number;
}

export interface AlertInfo {
  seq: number;
  sex: Sex;
  entryId: string;
  studentNumber: string;
  triggeredAt: number;
  acknowledgedBy?: AlertAcknowledgment | null;
}

export interface NextBySex {
  M: string | null;
  F: string | null;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  actorKey: string;
  updatedAt: number;
}

export interface ExamSession {
  id: string;
  controllerKey: string;
  inviteCode?: string;
  inviteVersion?: number;
  staffTokens?: Record<string, string>;
  pushSubscriptions?: PushSubscriptionRecord[];
  createdAt: number;
  version: number;
  clearedSeq: number;
  alertSeq: number;
  examConfig: ExamConfig | null;
  entries: QueueEntry[];
  staff: StaffMember[];
  nextBySex: NextBySex;
  lastNextAlert: AlertInfo | null;
}

export interface SessionSnapshot {
  id: string;
  inviteCode?: string;
  inviteVersion?: number;
  createdAt: number;
  version: number;
  clearedSeq: number;
  serverNowMs: number;
  effectiveNowMs: number;
  windowStatus: WindowStatus;
  examConfig: ExamConfig | null;
  entries: QueueEntry[];
  staff: StaffMember[];
  nextBySex: NextBySex;
  lastNextAlert: AlertInfo | null;
}

export type DomainErrorCode =
  | "OUTSIDE_TIME_WINDOW"
  | "BATHROOM_OCCUPIED"
  | "DUPLICATE_STUDENT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "OVERRIDE_REQUIRED";

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly windowStatus?: WindowStatus;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    options?: {
      windowStatus?: WindowStatus;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.windowStatus = options?.windowStatus;
    this.details = options?.details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

export type EntryAction = "enter" | "return" | "remove";

export type ReorderInput =
  | { entryId: string; targetIndex: number; direction?: undefined }
  | { entryId: string; direction: "up" | "down"; targetIndex?: undefined };

export interface SubmitStudentInput {
  sex: Sex;
  studentNumber: string;
  staffId?: string;
  submittedBy?: string;
  override?: boolean;
}

export interface ApplyEntryActionInput {
  entryId: string;
  action: EntryAction;
  override?: boolean;
}

export interface WindowEvaluation {
  windowStatus: WindowStatus;
  effectiveNowMs: number;
}

export interface ExamWindowBounds {
  startMs: number;
  endMs: number;
  allowStartMs: number;
  allowEndMs: number;
}
