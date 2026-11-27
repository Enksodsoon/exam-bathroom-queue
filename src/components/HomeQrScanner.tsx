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
        <div
          id="home-qr-scanner"
          role="dialog"
          aria-modal="true"
          aria-label="Staff QR scanner"
          data-testid="qr-scanner-modal"
          onClick={close}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
        >
          <section
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-md flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t.scannerModalTitle}
              </h2>
              <button
                ref={closeButton}
                type="button"
                onClick={close}
                aria-label={t.closeQrScanner}
                title={t.closeQrScanner}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-800 transition hover:bg-slate-200 focus-visible:outline-2 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-slate-950">
              <video
                ref={video}
                muted
                playsInline
                autoPlay
                aria-label="Camera preview"
                className={`aspect-square w-full object-cover ${ready ? "" : "opacity-80"}`}
              />
            </div>

            <p role="status" className="text-center text-sm text-slate-700 dark:text-slate-300">
              {message}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
