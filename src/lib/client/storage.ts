"use client";

import { useMemo, useSyncExternalStore } from "react";

export interface StoredStaffIdentity {
  staffId: string;
  label: string;
  staffToken?: string;
}

export interface RecentSessionRecord {
  sessionId: string;
  role: "controller" | "staff";
  label?: string;
  updatedAt: number;
}

const STORAGE_EVENT_NAME = "examq-storage-change";
const RECENT_SESSIONS_KEY = "examq_recent_sessions_v1";
const MAX_RECENT_SESSIONS = 5;
const EMPTY_RECENT_SESSIONS: RecentSessionRecord[] = [];
let cachedRecentRaw: string | null | undefined;
let cachedRecentParsed: RecentSessionRecord[] = EMPTY_RECENT_SESSIONS;

export function getControllerKeyStorageKey(sessionId: string): string {
  return `examq_controller_key_${sessionId}`;
}

export function getStaffStorageKey(sessionId: string): string {
  return `examq_staff_${sessionId}`;
}

function notifyStorageChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STORAGE_EVENT_NAME));
  }
}

function subscribeToStorage(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT_NAME, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT_NAME, callback);
  };
}

function readPersistentItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const fromSession = window.sessionStorage.getItem(key);
    if (fromSession !== null) {
      return fromSession;
    }
  } catch {
    // Ignore sessionStorage errors
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePersistentItem(key: string, value: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  let wroteAny = false;
  try {
    window.sessionStorage.setItem(key, value);
    wroteAny = true;
  } catch {
    // Ignore sessionStorage errors
  }
  try {
    window.localStorage.setItem(key, value);
    wroteAny = true;
  } catch {
    // Ignore localStorage errors
  }
  if (wroteAny) {
    notifyStorageChange();
  }
  return wroteAny;
}

function removePersistentItem(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore sessionStorage errors
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore localStorage errors
  }
  notifyStorageChange();
}

export function saveControllerKey(
  sessionId: string,
  controllerKey: string,
): boolean {
  const ok = writePersistentItem(
    getControllerKeyStorageKey(sessionId),
    controllerKey,
  );
  if (ok) {
    saveRecentSession({
      sessionId,
      role: "controller",
      updatedAt: Date.now(),
    });
  }
  return ok;
}

export function clearControllerKey(sessionId: string): void {
  removePersistentItem(getControllerKeyStorageKey(sessionId));
}

export function saveStaffIdentity(
  sessionId: string,
  identity: StoredStaffIdentity,
): boolean {
  const ok = writePersistentItem(
    getStaffStorageKey(sessionId),
    JSON.stringify(identity),
  );
  if (ok) {
    saveRecentSession({
      sessionId,
      role: "staff",
      label: identity.label,
      updatedAt: Date.now(),
    });
  }
  return ok;
}

export function clearStaffIdentity(sessionId: string): void {
  removePersistentItem(getStaffStorageKey(sessionId));
}

function readRecentSessionsSnapshot(): RecentSessionRecord[] {
  if (typeof window === "undefined") {
    return EMPTY_RECENT_SESSIONS;
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RECENT_SESSIONS_KEY);
  } catch {
    return EMPTY_RECENT_SESSIONS;
  }
  if (raw === cachedRecentRaw) {
    return cachedRecentParsed;
  }
  cachedRecentRaw = raw;
  if (!raw) {
    cachedRecentParsed = EMPTY_RECENT_SESSIONS;
    return EMPTY_RECENT_SESSIONS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      cachedRecentParsed = EMPTY_RECENT_SESSIONS;
      return EMPTY_RECENT_SESSIONS;
    }
    const valid = parsed.filter(
      (item): item is RecentSessionRecord =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentSessionRecord).sessionId === "string" &&
        ((item as RecentSessionRecord).role === "controller" ||
          (item as RecentSessionRecord).role === "staff") &&
        typeof (item as RecentSessionRecord).updatedAt === "number",
    );
    cachedRecentParsed = valid;
    return valid;
  } catch {
    cachedRecentParsed = EMPTY_RECENT_SESSIONS;
    return EMPTY_RECENT_SESSIONS;
  }
}

export function saveRecentSession(record: RecentSessionRecord): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const existing = readRecentSessionsSnapshot().filter(
      (item) =>
        !(item.sessionId === record.sessionId && item.role === record.role),
    );
    const next = [record, ...existing].slice(0, MAX_RECENT_SESSIONS);
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(RECENT_SESSIONS_KEY, serialized);
    cachedRecentRaw = serialized;
    cachedRecentParsed = next;
    notifyStorageChange();
  } catch {
    // Ignore storage errors
  }
}

export function removeRecentSession(sessionId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const existing = readRecentSessionsSnapshot();
    const next = existing.filter((item) => item.sessionId !== sessionId);
    if (next.length === existing.length) {
      return;
    }
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(RECENT_SESSIONS_KEY, serialized);
    cachedRecentRaw = serialized;
    cachedRecentParsed = next;
    notifyStorageChange();
  } catch {
    // Ignore storage errors
  }
}

export function useRecentSessions(): RecentSessionRecord[] {
  return useSyncExternalStore(
    subscribeToStorage,
    readRecentSessionsSnapshot,
    () => EMPTY_RECENT_SESSIONS,
  );
}

export function useStoredControllerKey(sessionId: string): string | null {
  const storageKey = getControllerKeyStorageKey(sessionId);
  return useSyncExternalStore(
    subscribeToStorage,
    () => readPersistentItem(storageKey),
    () => null,
  );
}

export function useStoredStaffIdentity(
  sessionId: string,
): StoredStaffIdentity | null {
  const storageKey = getStaffStorageKey(sessionId);
  const raw = useSyncExternalStore(
    subscribeToStorage,
    () => readPersistentItem(storageKey),
    () => null,
  );

  return useMemo(() => {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as StoredStaffIdentity).staffId === "string" &&
        typeof (parsed as StoredStaffIdentity).label === "string"
      ) {
        return {
          staffId: (parsed as StoredStaffIdentity).staffId,
          label: (parsed as StoredStaffIdentity).label,
          ...(typeof (parsed as StoredStaffIdentity).staffToken === "string"
            ? { staffToken: (parsed as StoredStaffIdentity).staffToken }
            : {}),
        };
      }
      return null;
    } catch {
      return null;
    }
  }, [raw]);
}

function subscribeNoop(): () => void {
  return () => {};
}

export function useClientOrigin(): string {
  return useSyncExternalStore(
    subscribeNoop,
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    () => "",
  );
}
