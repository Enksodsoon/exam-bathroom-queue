"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveExamJoinPath } from "@/lib/client/joinLink";
import { useAppPreferences } from "./AppPreferencesProvider";
import { CloseIcon, QrIcon } from "./Icons";

interface HomeQrScannerProps {
  onJoin: (path: string) => void;
}

export function HomeQrScanner({ onJoin }: HomeQrScannerProps) {
  const { t } = useAppPreferences();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const launch = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef(0);
  const attempt = useRef(0);

  const stop = useCallback(() => {
    attempt.current += 1;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    stop();
    setOpen(false);
    setReady(false);
    requestAnimationFrame(() => launch.current?.focus());
  }, [stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const handleVisibility = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [close, open]);

  async function start() {
    stop();
    const current = attempt.current;
    setOpen(true);
    setReady(false);
    setMessage("Starting camera…");
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(t.qrScannerNoCamera);
      return;
    }

    try {
      // Request video directly from the user's tap. Never ask for the microphone.
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (current !== attempt.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const { default: decode } = await import("jsqr");
      if (current !== attempt.current) return;
      const v = video.current;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!v || !ctx) throw new Error("Camera preview could not start");
      v.srcObject = media;
      await v.play();
      if (current !== attempt.current) return;
      setReady(true);
      setMessage(t.qrScannerHint);
      let last = 0;

      const tick = (now: number) => {
        if (current !== attempt.current) return;
        if (now - last > 150 && v.readyState >= 2 && v.videoWidth && v.videoHeight) {
          last = now;
          const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = decode(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            const path = resolveExamJoinPath(code.data, window.location.origin, true);
            if (path) {
              stop();
              setOpen(false);
              setReady(false);
              onJoin(path);
              return;
            }
            setMessage(t.qrScannerNotExamQ);
          }
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch (error) {
      if (current !== attempt.current) return;
      stop();
      setReady(false);
      setMessage(error instanceof Error && error.name === "NotAllowedError"
        ? t.qrScannerBlocked
        : t.qrScannerNoCamera);
    }
  }

  return (
    <div>
      <button
        ref={launch}
        type="button"
        aria-expanded={open}
        aria-controls={open ? "home-qr-scanner" : undefined}
        onClick={() => open ? close() : void start()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-sky-800 px-4 text-sm font-semibold text-white hover:bg-sky-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500"
      >
        <QrIcon className="h-4 w-4" /> {t.scanQrCode}
      </button>
      {open && (
        <section
          id="home-qr-scanner"
          aria-label="Staff QR scanner"
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          className="mt-3 space-y-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-700 dark:bg-slate-900/60"
        >
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            aria-label="Camera preview"
            className={`max-h-60 w-full rounded-xl bg-slate-900 object-contain ${ready ? "" : "aspect-video"}`}
          />
          <p role="status" className="text-sm text-slate-700 dark:text-slate-300">{message}</p>
          <button ref={closeButton} type="button" onClick={close} aria-label={t.closeQrScanner}
            title={t.closeQrScanner} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-800 focus-visible:outline-2 dark:bg-slate-800 dark:text-slate-200">
            <CloseIcon className="h-4 w-4" />
          </button>
        </section>
      )}
    </div>
  );
}
