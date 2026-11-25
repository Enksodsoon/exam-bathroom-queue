"use client";

import { useMemo, useSyncExternalStore } from "react";

export interface StoredStaffIdentity {
  staffId: string;
  label: string;
}

const STORAGE_EVENT_NAME = "examq-storage-change";

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

function readSessionStorageItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveControllerKey(sessionId: string, controllerKey: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      getControllerKeyStorageKey(sessionId),
      controllerKey,
    );
    notifyStorageChange();
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function clearControllerKey(sessionId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(getControllerKeyStorageKey(sessionId));
    notifyStorageChange();
  } catch {
    // Ignore storage errors
  }
}

export function saveStaffIdentity(
  sessionId: string,
  identity: StoredStaffIdentity,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      getStaffStorageKey(sessionId),
      JSON.stringify(identity),
    );
    notifyStorageChange();
  } catch {
    // Ignore storage errors
  }
}

export function clearStaffIdentity(sessionId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(getStaffStorageKey(sessionId));
    notifyStorageChange();
  } catch {
    // Ignore storage errors
  }
}

export function useStoredControllerKey(sessionId: string): string | null {
  const storageKey = getControllerKeyStorageKey(sessionId);
  return useSyncExternalStore(
    subscribeToStorage,
    () => readSessionStorageItem(storageKey),
    () => null,
  );
}

export function useStoredStaffIdentity(
  sessionId: string,
): StoredStaffIdentity | null {
  const storageKey = getStaffStorageKey(sessionId);
  const raw = useSyncExternalStore(
    subscribeToStorage,
    () => readSessionStorageItem(storageKey),
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
