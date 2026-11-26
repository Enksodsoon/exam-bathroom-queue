"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export function useWakeLock() {
  const supported =
    typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  const release = useCallback(async () => {
    try {
      await sentinelRef.current?.release();
    } catch {
      // Ignore
    } finally {
      sentinelRef.current = null;
      setActive(false);
    }
  }, []);

  const request = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    try {
      const nav = navigator as unknown as {
        wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      };
      const sentinel = await nav.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener?.("release", () => {
        sentinelRef.current = null;
        setActive(false);
      });
      return true;
    } catch {
      setActive(false);
      return false;
    }
  }, [supported]);

  const toggle = useCallback(async () => {
    if (active) {
      await release();
    } else {
      await request();
    }
  }, [active, release, request]);

  useEffect(() => {
    return () => {
      void sentinelRef.current?.release().catch(() => {});
    };
  }, []);

  return { supported, active, toggle };
}
