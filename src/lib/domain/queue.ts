import { reconcileNextAndAlerts } from "./alerts";
import {
  DomainError,
  type AlertInfo,
  type ApplyEntryActionInput,
  type ExamConfig,
  type ExamSession,
  type NextBySex,
  type PushSubscriptionRecord,
  type QueueEntry,
  type ReorderInput,
  type SessionSnapshot,
  type StaffMember,
  type SubmitStudentInput,
} from "./types";
import {
  evaluateExamWindow,
  getExamWindowBounds,
  MAX_VALID_DATE_MS,
} from "./window";

const MAX_STAFF_LABEL_LENGTH = 40;
const MAX_STUDENT_NUMBER_LENGTH = 32;
const MAX_ENTRIES_PER_SESSION = 500;
const MAX_STAFF_PER_SESSION = 50;
const MAX_PUSH_SUBSCRIPTIONS = 50;

function defaultIdGenerator(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new DomainError(
    "INVALID_STATE",
    "crypto.randomUUID is unavailable; provide an explicit idGenerator",
  );
}

function assertFiniteNow(nowMs: number, fieldName = "nowMs"): void {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} must be a finite number`,
    );
  }
  if (Math.abs(nowMs) > MAX_VALID_DATE_MS) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} must be within valid Date range`,
    );
  }
}

function assertNonEmptyId(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} must be a non-empty string`,
    );
  }
  return value.trim();
}

function cloneExamConfig(config: ExamConfig | null): ExamConfig | null {
  if (!config) {
    return null;
  }
  return { ...config };
}

function cloneEntry(entry: QueueEntry): QueueEntry {
  return { ...entry };
}

function cloneStaff(member: StaffMember): StaffMember {
  return { ...member };
}

function cloneNextBySex(nextBySex: NextBySex): NextBySex {
  return { M: nextBySex.M, F: nextBySex.F };
}

function cloneAlert(alert: AlertInfo | null): AlertInfo | null {
  if (!alert) {
    return null;
  }
  return {
    ...alert,
    ...(alert.acknowledgedBy !== undefined
      ? {
          acknowledgedBy: alert.acknowledgedBy
            ? { ...alert.acknowledgedBy }
            : null,
        }
      : {}),
  };
}

function cloneSession(session: ExamSession): ExamSession {
  return {
    id: session.id,
    controllerKey: session.controllerKey,
    ...(session.inviteCode !== undefined ? { inviteCode: session.inviteCode } : {}),
    ...(session.inviteVersion !== undefined
      ? { inviteVersion: session.inviteVersion }
      : {}),
    ...(session.staffTokens !== undefined
      ? { staffTokens: { ...session.staffTokens } }
      : {}),
    ...(session.pushSubscriptions !== undefined
      ? {
          pushSubscriptions: session.pushSubscriptions.map((sub) => ({
            endpoint: sub.endpoint,
            keys: { ...sub.keys },
            actorKey: sub.actorKey,
            updatedAt: sub.updatedAt,
          })),
        }
      : {}),
    createdAt: session.createdAt,
    version: session.version,
    clearedSeq: session.clearedSeq,
    alertSeq: session.alertSeq,
    examConfig: cloneExamConfig(session.examConfig),
    entries: session.entries.map(cloneEntry),
    staff: session.staff.map(cloneStaff),
    nextBySex: cloneNextBySex(session.nextBySex),
    lastNextAlert: cloneAlert(session.lastNextAlert),
  };
}

export function createSession(
  nowMs: number = Date.now(),
  options?: {
    id?: string;
    controllerKey?: string;
    inviteCode?: string;
    idGenerator?: () => string;
  },
): ExamSession {
  assertFiniteNow(nowMs);
  const gen = options?.idGenerator ?? defaultIdGenerator;
  const id = assertNonEmptyId(options?.id ?? gen(), "session id");
  const controllerKey = assertNonEmptyId(
    options?.controllerKey ?? gen(),
    "controllerKey",
  );
  const inviteCode = assertNonEmptyId(
    options?.inviteCode ?? gen(),
    "inviteCode",
  );

  return {
    id,
    controllerKey,
    inviteCode,
    inviteVersion: 1,
    staffTokens: {},
    createdAt: nowMs,
    version: 1,
    clearedSeq: 0,
    alertSeq: 0,
    examConfig: null,
    entries: [],
    staff: [],
    nextBySex: { M: null, F: null },
    lastNextAlert: null,
  };
}

export function toSessionSnapshot(
  session: ExamSession,
  nowMs: number = Date.now(),
): SessionSnapshot {
  assertFiniteNow(nowMs);
  const { windowStatus, effectiveNowMs } = evaluateExamWindow(
    session.examConfig,
    nowMs,
  );

  return {
    id: session.id,
    ...(session.inviteCode !== undefined ? { inviteCode: session.inviteCode } : {}),
    ...(session.inviteVersion !== undefined
      ? { inviteVersion: session.inviteVersion }
      : {}),
    createdAt: session.createdAt,
    version: session.version,
    clearedSeq: session.clearedSeq,
    serverNowMs: nowMs,
    effectiveNowMs,
    windowStatus,
    examConfig: cloneExamConfig(session.examConfig),
    entries: session.entries.map(cloneEntry),
    staff: session.staff.map(cloneStaff),
    nextBySex: cloneNextBySex(session.nextBySex),
    lastNextAlert: cloneAlert(session.lastNextAlert),
  };
}

export function joinStaff(
  session: ExamSession,
  input: { label: string },
  nowMs: number = Date.now(),
  options?: { idGenerator?: () => string },
): { session: ExamSession; staff: StaffMember; staffToken: string } {
  assertFiniteNow(nowMs);
  if (typeof input?.label !== "string") {
    throw new DomainError("INVALID_INPUT", "Staff label must be a string");
  }

  const label = input.label.trim();
  if (label.length === 0 || label.length > MAX_STAFF_LABEL_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `Staff label must be 1 to ${MAX_STAFF_LABEL_LENGTH} characters`,
    );
  }

  const gen = options?.idGenerator ?? defaultIdGenerator;
  const normalized = label.toLowerCase();
  const nextStaffList = session.staff.map(cloneStaff);
  const existingIndex = nextStaffList.findIndex(
    (member) => member.label.toLowerCase() === normalized,
  );

  let staffMember: StaffMember;
  if (existingIndex >= 0) {
    const existing = nextStaffList[existingIndex];
    staffMember = {
      id: existing.id,
      label,
      joinedAt: existing.joinedAt,
      lastSeenAt: nowMs,
    };
    nextStaffList[existingIndex] = staffMember;
  } else {
    if (nextStaffList.length >= MAX_STAFF_PER_SESSION) {
      throw new DomainError(
        "INVALID_STATE",
        `Maximum staff limit (${MAX_STAFF_PER_SESSION}) reached for this session`,
      );
    }
    const id = assertNonEmptyId(gen(), "staff id");
    staffMember = {
      id,
      label,
      joinedAt: nowMs,
      lastSeenAt: nowMs,
    };
    nextStaffList.push(staffMember);
  }

  const staffToken = assertNonEmptyId(gen(), "staffToken");
  const nextTokens = { ...(session.staffTokens ?? {}), [staffToken]: staffMember.id };

  const nextSession: ExamSession = {
    ...cloneSession(session),
    staff: nextStaffList,
    staffTokens: nextTokens,
    version: session.version + 1,
  };

  return {
    session: nextSession,
    staff: { ...staffMember },
    staffToken,
  };
}

export function rotateInvite(
  session: ExamSession,
  nowMs: number = Date.now(),
  options?: { idGenerator?: () => string },
): ExamSession {
  assertFiniteNow(nowMs);
  const gen = options?.idGenerator ?? defaultIdGenerator;
  const inviteCode = assertNonEmptyId(gen(), "inviteCode");
  const cloned = cloneSession(session);
  const retainedSubs = (cloned.pushSubscriptions ?? []).filter(
    (sub) => !sub.actorKey.startsWith("staff:"),
  );

  return {
    ...cloned,
    inviteCode,
    inviteVersion: (session.inviteVersion ?? 1) + 1,
    staffTokens: {},
    ...(cloned.pushSubscriptions !== undefined
      ? { pushSubscriptions: retainedSubs }
      : {}),
    version: session.version + 1,
  };
}

export function acknowledgeAlert(
  session: ExamSession,
  input: {
    actorKey: string;
    label: string;
    seq: number;
  },
  nowMs: number = Date.now(),
): ExamSession {
  assertFiniteNow(nowMs);
  const currentAlert = session.lastNextAlert;
  if (
    !currentAlert ||
    currentAlert.seq !== input.seq ||
    currentAlert.acknowledgedBy
  ) {
    return session;
  }

  const cloned = cloneSession(session);
  return {
    ...cloned,
    lastNextAlert: {
      ...currentAlert,
      acknowledgedBy: {
        actorKey: input.actorKey,
        label: input.label,
        at: nowMs,
      },
    },
    version: session.version + 1,
  };
}

export function updateExamConfig(
  session: ExamSession,
  input: ExamConfig,
  nowMs: number = Date.now(),
): ExamSession {
  assertFiniteNow(nowMs);
  if (!input || typeof input !== "object") {
    throw new DomainError("INVALID_INPUT", "ExamConfig input is required");
  }

  getExamWindowBounds(input);

  if (
    input.clockOffsetMs !== undefined &&
    (typeof input.clockOffsetMs !== "number" ||
      !Number.isFinite(input.clockOffsetMs))
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "clockOffsetMs must be a finite number",
    );
  }

  // Older clients can save the timer without resetting already-saved block lengths.
  const firstBlockMinutes = input.firstBlockMinutes ?? session.examConfig?.firstBlockMinutes;
  const lastBlockMinutes = input.lastBlockMinutes ?? session.examConfig?.lastBlockMinutes;
  const nextConfig: ExamConfig = {
    startTimeMs: input.startTimeMs,
    durationMinutes: input.durationMinutes,
    ...(firstBlockMinutes !== undefined ? { firstBlockMinutes } : {}),
    ...(lastBlockMinutes !== undefined ? { lastBlockMinutes } : {}),
    clockOffsetMs: input.clockOffsetMs ?? 0,
  };

  evaluateExamWindow(nextConfig, nowMs);

  return {
    ...cloneSession(session),
    examConfig: nextConfig,
    version: session.version + 1,
  };
}

export function submitStudent(
  session: ExamSession,
  input: SubmitStudentInput,
  nowMs: number = Date.now(),
  options?: { idGenerator?: () => string },
): { session: ExamSession; entry: QueueEntry } {
  assertFiniteNow(nowMs);

  if (!input || (input.sex !== "M" && input.sex !== "F")) {
    throw new DomainError("INVALID_INPUT", "sex must be 'M' or 'F'");
  }

  if (typeof input.studentNumber !== "string") {
    throw new DomainError("INVALID_INPUT", "studentNumber must be a string");
  }

  const studentNumber = input.studentNumber.trim();
  if (
    studentNumber.length === 0 ||
    studentNumber.length > MAX_STUDENT_NUMBER_LENGTH
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      `studentNumber must be 1 to ${MAX_STUDENT_NUMBER_LENGTH} characters`,
    );
  }

  const { windowStatus } = evaluateExamWindow(session.examConfig, nowMs);
  const override = Boolean(input.override);
  if (windowStatus !== "ALLOWED" && !override) {
    throw new DomainError(
      "OUTSIDE_TIME_WINDOW",
      `Bathroom submissions are blocked during ${windowStatus}`,
      { windowStatus },
    );
  }

  const normalizedStudent = studentNumber.toLowerCase();
  const duplicate = session.entries.find(
    (entry) =>
      (entry.status === "queued" || entry.status === "in_bathroom") &&
      entry.studentNumber.toLowerCase() === normalizedStudent,
  );
  if (duplicate) {
    throw new DomainError(
      "DUPLICATE_STUDENT",
      `Student '${studentNumber}' is already active in the queue`,
      { details: { entryId: duplicate.id, status: duplicate.status } },
    );
  }

  const nextStaff = session.staff.map(cloneStaff);
  let submittedBy: string;
  if (typeof input.staffId === "string" && input.staffId.trim().length > 0) {
    const trimmedStaffId = input.staffId.trim();
    const matchedStaff = nextStaff.find(
      (member) => member.id === trimmedStaffId,
    );
    if (matchedStaff) {
      matchedStaff.lastSeenAt = nowMs;
      submittedBy = matchedStaff.label;
    } else if (
      typeof input.submittedBy === "string" &&
      input.submittedBy.trim().length > 0
    ) {
      submittedBy = input.submittedBy
        .trim()
        .slice(0, MAX_STAFF_LABEL_LENGTH);
    } else {
      submittedBy = override ? "Controller" : "Staff";
    }
  } else if (
    typeof input.submittedBy === "string" &&
    input.submittedBy.trim().length > 0
  ) {
    submittedBy = input.submittedBy.trim().slice(0, MAX_STAFF_LABEL_LENGTH);
  } else {
    submittedBy = override ? "Controller" : "Staff";
  }

  const gen = options?.idGenerator ?? defaultIdGenerator;
  const entryId = assertNonEmptyId(gen(), "entry id");

  const newEntry: QueueEntry = {
    id: entryId,
    sex: input.sex,
    studentNumber,
    status: "queued",
    submittedBy,
    createdAt: nowMs,
    enteredAt: null,
    returnedAt: null,
    override,
  };

  const nextEntries = [...session.entries.map(cloneEntry), newEntry];
  if (nextEntries.length > MAX_ENTRIES_PER_SESSION) {
    const pruneIdx = nextEntries.findIndex(
      (item) => item.status === "returned" || item.status === "removed",
    );
    if (pruneIdx >= 0) {
      nextEntries.splice(pruneIdx, 1);
    } else {
      throw new DomainError(
        "INVALID_STATE",
        `Maximum active entries (${MAX_ENTRIES_PER_SESSION}) reached for this session`,
      );
    }
  }
  const reconciled = reconcileNextAndAlerts({
    prevNextBySex: session.nextBySex,
    entries: nextEntries,
    prevAlertSeq: session.alertSeq,
    prevLastNextAlert: session.lastNextAlert,
    triggeredAt: nowMs,
  });

  const nextSession: ExamSession = {
    ...cloneSession(session),
    staff: nextStaff,
    entries: nextEntries,
    nextBySex: reconciled.nextBySex,
    alertSeq: reconciled.alertSeq,
    lastNextAlert: reconciled.lastNextAlert,
    version: session.version + 1,
  };

  return {
    session: nextSession,
    entry: { ...newEntry },
  };
}

export function applyEntryAction(
  session: ExamSession,
  input: ApplyEntryActionInput,
  nowMs: number = Date.now(),
): { session: ExamSession; entry: QueueEntry } {
  assertFiniteNow(nowMs);

  if (
    !input ||
    (input.action !== "enter" &&
      input.action !== "return" &&
      input.action !== "remove")
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "action must be 'enter', 'return', or 'remove'",
    );
  }

  const entryId = assertNonEmptyId(input.entryId, "entryId");
  const nextEntries = session.entries.map(cloneEntry);
  const targetIndex = nextEntries.findIndex((item) => item.id === entryId);
  if (targetIndex < 0) {
    throw new DomainError("NOT_FOUND", `Queue entry '${entryId}' not found`);
  }

  const target = nextEntries[targetIndex];
  let updatedEntry: QueueEntry;

  if (input.action === "enter") {
    if (target.status !== "queued") {
      throw new DomainError(
        "INVALID_STATE",
        `Cannot mark entry '${entryId}' as in_bathroom from status '${target.status}'`,
      );
    }

    const occupied = nextEntries.find(
      (item) => item.sex === target.sex && item.status === "in_bathroom",
    );
    if (occupied) {
      throw new DomainError(
        "BATHROOM_OCCUPIED",
        `A ${target.sex === "M" ? "Male" : "Female"} student is already in the bathroom`,
        { details: { occupiedEntryId: occupied.id } },
      );
    }

    const { windowStatus } = evaluateExamWindow(session.examConfig, nowMs);
    const override = Boolean(input.override);
    if (windowStatus !== "ALLOWED" && !override) {
      throw new DomainError(
        "OUTSIDE_TIME_WINDOW",
        `Entering bathroom is blocked during ${windowStatus}`,
        { windowStatus },
      );
    }

    updatedEntry = {
      ...target,
      status: "in_bathroom",
      enteredAt: nowMs,
      override: target.override || override,
    };
  } else if (input.action === "return") {
    if (target.status !== "in_bathroom") {
      throw new DomainError(
        "INVALID_STATE",
        `Cannot mark entry '${entryId}' as returned from status '${target.status}'`,
      );
    }

    updatedEntry = {
      ...target,
      status: "returned",
      returnedAt: nowMs,
    };
  } else {
    if (target.status === "in_bathroom") {
      throw new DomainError(
        "INVALID_STATE",
        `Cannot remove entry '${entryId}' while student is in the bathroom; mark returned instead`,
      );
    }
    if (target.status !== "queued") {
      throw new DomainError(
        "INVALID_STATE",
        `Cannot remove entry '${entryId}' from status '${target.status}'`,
      );
    }

    updatedEntry = {
      ...target,
      status: "removed",
    };
  }

  nextEntries[targetIndex] = updatedEntry;

  const reconciled = reconcileNextAndAlerts({
    prevNextBySex: session.nextBySex,
    entries: nextEntries,
    prevAlertSeq: session.alertSeq,
    prevLastNextAlert: session.lastNextAlert,
    triggeredAt: nowMs,
  });

  const nextSession: ExamSession = {
    ...cloneSession(session),
    entries: nextEntries,
    nextBySex: reconciled.nextBySex,
    alertSeq: reconciled.alertSeq,
    lastNextAlert: reconciled.lastNextAlert,
    version: session.version + 1,
  };

  return {
    session: nextSession,
    entry: { ...updatedEntry },
  };
}

export function reorderQueuedEntry(
  session: ExamSession,
  input: ReorderInput,
  nowMs: number = Date.now(),
): ExamSession {
  assertFiniteNow(nowMs);
  if (!input || typeof input !== "object") {
    throw new DomainError("INVALID_INPUT", "Reorder input is required");
  }

  const raw = input as {
    entryId?: unknown;
    direction?: unknown;
    targetIndex?: unknown;
  };
  const entryId = assertNonEmptyId(raw.entryId, "entryId");
  const hasDirection = raw.direction !== undefined;
  const hasTargetIndex = raw.targetIndex !== undefined;

  if (hasDirection && hasTargetIndex) {
    throw new DomainError(
      "INVALID_INPUT",
      "Provide either direction or targetIndex, not both",
    );
  }
  if (!hasDirection && !hasTargetIndex) {
    throw new DomainError(
      "INVALID_INPUT",
      "Must provide direction or targetIndex",
    );
  }

  const entryIndex = session.entries.findIndex((item) => item.id === entryId);
  if (entryIndex < 0) {
    throw new DomainError("NOT_FOUND", `Queue entry '${entryId}' not found`);
  }

  const targetEntry = session.entries[entryIndex];
  if (targetEntry.status !== "queued") {
    throw new DomainError(
      "INVALID_STATE",
      `Only queued entries can be reordered (got '${targetEntry.status}')`,
    );
  }

  const queuedIndices: number[] = [];
  for (let i = 0; i < session.entries.length; i += 1) {
    const candidate = session.entries[i];
    if (candidate.sex === targetEntry.sex && candidate.status === "queued") {
      queuedIndices.push(i);
    }
  }

  const currentPos = queuedIndices.indexOf(entryIndex);
  let targetPos: number;

  if (hasDirection) {
    if (raw.direction !== "up" && raw.direction !== "down") {
      throw new DomainError(
        "INVALID_INPUT",
        "direction must be 'up' or 'down'",
      );
    }
    const delta = raw.direction === "up" ? -1 : 1;
    targetPos = Math.max(
      0,
      Math.min(queuedIndices.length - 1, currentPos + delta),
    );
  } else {
    if (
      typeof raw.targetIndex !== "number" ||
      !Number.isInteger(raw.targetIndex) ||
      raw.targetIndex < 0 ||
      raw.targetIndex >= queuedIndices.length
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        `targetIndex must be an integer between 0 and ${queuedIndices.length - 1}`,
      );
    }
    targetPos = raw.targetIndex;
  }

  if (targetPos === currentPos) {
    return cloneSession(session);
  }

  const nextEntries = session.entries.map(cloneEntry);
  const queuedForSex = queuedIndices.map((idx) => nextEntries[idx]);
  const [moved] = queuedForSex.splice(currentPos, 1);
  queuedForSex.splice(targetPos, 0, moved);

  for (let i = 0; i < queuedIndices.length; i += 1) {
    nextEntries[queuedIndices[i]] = queuedForSex[i];
  }

  const reconciled = reconcileNextAndAlerts({
    prevNextBySex: session.nextBySex,
    entries: nextEntries,
    prevAlertSeq: session.alertSeq,
    prevLastNextAlert: session.lastNextAlert,
    triggeredAt: nowMs,
  });

  return {
    ...cloneSession(session),
    entries: nextEntries,
    nextBySex: reconciled.nextBySex,
    alertSeq: reconciled.alertSeq,
    lastNextAlert: reconciled.lastNextAlert,
    version: session.version + 1,
  };
}

export function clearSession(
  session: ExamSession,
  nowMs: number = Date.now(),
  options?: { force?: boolean },
): ExamSession {
  assertFiniteNow(nowMs);

  const activeOut = session.entries.filter(
    (entry) => entry.status === "in_bathroom",
  );
  if (activeOut.length > 0 && !options?.force) {
    throw new DomainError(
      "BATHROOM_OCCUPIED",
      `Cannot clear session while ${activeOut.map((e) => `#${e.studentNumber}`).join(", ")} is still in the bathroom`,
      {
        details: {
          activeStudentNumbers: activeOut.map((e) => e.studentNumber),
        },
      },
    );
  }

  const cloned = cloneSession(session);
  return {
    ...cloned,
    entries: [],
    nextBySex: { M: null, F: null },
    lastNextAlert: null,
    clearedSeq: session.clearedSeq + 1,
    version: session.version + 1,
  };
}

export function upsertPushSubscription(
  session: ExamSession,
  input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    actorKey: string;
  },
  nowMs: number = Date.now(),
): ExamSession {
  assertFiniteNow(nowMs);
  const endpoint = input.endpoint.trim();
  const cloned = cloneSession(session);
  const existing = cloned.pushSubscriptions ?? [];
  const filtered = existing.filter((s) => s.endpoint !== endpoint);
  const nextRecord: PushSubscriptionRecord = {
    endpoint,
    keys: {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    },
    actorKey: input.actorKey,
    updatedAt: nowMs,
  };
  const nextSubs = [...filtered, nextRecord].slice(-MAX_PUSH_SUBSCRIPTIONS);

  return {
    ...cloned,
    pushSubscriptions: nextSubs,
  };
}

export function removePushSubscription(
  session: ExamSession,
  endpoint: string,
): ExamSession {
  const trimmed = endpoint.trim();
  const existing = session.pushSubscriptions ?? [];
  const nextSubs = existing.filter((s) => s.endpoint !== trimmed);
  if (nextSubs.length === existing.length) {
    return session;
  }
  const cloned = cloneSession(session);
  return {
    ...cloned,
    pushSubscriptions: nextSubs,
  };
}

export function prunePushSubscriptions(
  session: ExamSession,
  expiredEndpoints: string[],
): ExamSession {
  if (expiredEndpoints.length === 0) {
    return session;
  }
  const expiredSet = new Set(expiredEndpoints.map((e) => e.trim()));
  const existing = session.pushSubscriptions ?? [];
  const nextSubs = existing.filter((s) => !expiredSet.has(s.endpoint));
  if (nextSubs.length === existing.length) {
    return session;
  }
  const cloned = cloneSession(session);
  return {
    ...cloned,
    pushSubscriptions: nextSubs,
  };
}
