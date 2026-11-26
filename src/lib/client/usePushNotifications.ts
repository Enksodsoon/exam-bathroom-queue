"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export interface PushAuth {
  controllerKey?: string | null;
  staffToken?: string | null;
}

export type PushPermissionState =
  | NotificationPermission
  | "unsupported";

export interface UsePushNotificationsResult {
  supported: boolean;
  vapidConfigured: boolean;
  permission: PushPermissionState;
  isSubscribed: boolean;
  isBusy: boolean;
  isIosBrowserNotStandalone: boolean;
  error: string | null;
  enablePush: () => Promise<boolean>;
  disablePush: () => Promise<void>;
  togglePush: () => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function detectIosBrowserNotStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent || "";
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIosDevice) {
    return false;
  }
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

function buildAuthHeaders(auth: PushAuth): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth.controllerKey) {
    headers["X-Controller-Key"] = auth.controllerKey;
  } else if (auth.staffToken) {
    headers["X-Staff-Token"] = auth.staffToken;
  }
  return headers;
}

async function syncSubscriptionToServer(
  sessionId: string,
  auth: PushAuth,
  sub: PushSubscription,
): Promise<void> {
  const json = sub.toJSON();
  const endpoint = json.endpoint ?? sub.endpoint;
  const p256dh = json.keys?.p256dh;
  const authKey = json.keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    throw new Error("Browser returned an incomplete push subscription.");
  }

  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/push-subscribe`,
    {
      method: "POST",
      headers: buildAuthHeaders(auth),
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth: authKey },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Push subscribe failed (${res.status})`);
  }
}

const emptySubscribe = () => () => {};

function getPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function getBrowserNotificationPermission(): PushPermissionState {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export function usePushNotifications(
  sessionId: string,
  auth: PushAuth,
): UsePushNotificationsResult {
  const vapidPublicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const vapidConfigured = vapidPublicKey.length > 0;

  const supported = useSyncExternalStore(
    emptySubscribe,
    getPushSupported,
    () => false,
  );
  const isIosBrowserNotStandalone = useSyncExternalStore(
    emptySubscribe,
    detectIosBrowserNotStandalone,
    () => false,
  );
  const detectedPermission = useSyncExternalStore<PushPermissionState>(
    emptySubscribe,
    getBrowserNotificationPermission,
    () => "unsupported",
  );
  const [permissionOverride, setPermissionOverride] =
    useState<PushPermissionState | null>(null);
  const permission = permissionOverride ?? detectedPermission;

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAuth = Boolean(auth.controllerKey || auth.staffToken);

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        const active = Boolean(
          existing && Notification.permission === "granted",
        );
        setIsSubscribed(active);

        if (active && existing && hasAuth) {
          await syncSubscriptionToServer(sessionId, auth, existing).catch(
            () => {
              // Silent background re-sync; user can still re-toggle manually.
            },
          );
        }
      } catch {
        // Ignore SW init errors on unsupported contexts (e.g. non-HTTPS non-localhost)
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, sessionId, auth.controllerKey, auth.staffToken, hasAuth]);

  const enablePush = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!supported) {
      setError("Push notifications are not supported on this browser.");
      return false;
    }
    if (!vapidConfigured) {
      setError("Push notifications are not configured on the server yet.");
      return false;
    }
    if (!hasAuth) {
      setError("Join the session first to enable alerts.");
      return false;
    }

    setIsBusy(true);
    try {
      const nextPermission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setPermissionOverride(nextPermission);

      if (nextPermission !== "granted") {
        setIsSubscribed(false);
        setError(
          nextPermission === "denied"
            ? "Notifications are blocked in browser settings."
            : "Notification permission was dismissed.",
        );
        return false;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      await syncSubscriptionToServer(sessionId, auth, sub);
      setIsSubscribed(true);
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not enable push notifications.",
      );
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [auth, hasAuth, sessionId, supported, vapidConfigured, vapidPublicKey]);

  const disablePush = useCallback(async (): Promise<void> => {
    setError(null);
    if (!supported) return;
    setIsBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        if (hasAuth) {
          await fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/push-subscribe`,
            {
              method: "DELETE",
              headers: buildAuthHeaders(auth),
              body: JSON.stringify({ endpoint: sub.endpoint }),
            },
          ).catch(() => {});
        }
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not disable push notifications.",
      );
    } finally {
      setIsBusy(false);
    }
  }, [auth, hasAuth, sessionId, supported]);

  const togglePush = useCallback(async (): Promise<void> => {
    if (isSubscribed) {
      await disablePush();
    } else {
      await enablePush();
    }
  }, [disablePush, enablePush, isSubscribed]);

  return {
    supported,
    vapidConfigured,
    permission,
    isSubscribed,
    isBusy,
    isIosBrowserNotStandalone,
    error,
    enablePush,
    disablePush,
    togglePush,
  };
}
