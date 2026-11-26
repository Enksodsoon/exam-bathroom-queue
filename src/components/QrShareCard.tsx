"use client";

import { useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useClientOrigin } from "@/lib/client/storage";
import { useAppPreferences } from "./AppPreferencesProvider";
import { CheckReturnIcon, CopyIcon, ResetIcon } from "./Icons";

interface QrShareCardProps {
  sessionId: string;
  inviteCode?: string;
  rotatingInvite?: boolean;
  onRotateInvite?: () => void;
}

const QR_MARGIN = 4;

export function QrShareCard({
  sessionId,
  inviteCode,
  rotatingInvite = false,
  onRotateInvite,
}: QrShareCardProps) {
  const { t } = useAppPreferences();
  const origin = useClientOrigin();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const urlBoxRef = useRef<HTMLInputElement | null>(null);

  const relativeJoinPath = inviteCode
    ? `/s/${encodeURIComponent(sessionId)}?invite=${encodeURIComponent(inviteCode)}`
    : `/s/${encodeURIComponent(sessionId)}`;
  const shareUrl = origin ? `${origin}${relativeJoinPath}` : relativeJoinPath;

  const qrSvg = useMemo(() => {
    const qr = QRCode.create(shareUrl, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const totalSize = size + QR_MARGIN * 2;
    const commands: string[] = [];

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (qr.modules.get(row, col)) {
          commands.push(`M${col + QR_MARGIN},${row + QR_MARGIN}h1v1h-1z`);
        }
      }
    }

    return {
      viewBox: `0 0 ${totalSize} ${totalSize}`,
      path: commands.join(""),
    };
  }, [shareUrl]);

  const handleCopy = async () => {
    setCopyError(null);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
        return;
      }
    } catch {
      // Fall through to manual select fallback
    }
    urlBoxRef.current?.focus();
    urlBoxRef.current?.select();
    setCopyError("Clipboard unavailable — link selected for manual copy.");
  };

  return (
    <section
      aria-label="Share Session Link and QR Code"
      className="min-w-0 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-2.5 dark:border-slate-700">
          <svg
            role="img"
            aria-label={`QR code to join exam session ${sessionId}`}
            data-qr-url={shareUrl}
            viewBox={qrSvg.viewBox}
            className="h-36 w-36"
            shapeRendering="crispEdges"
          >
            <rect width="100%" height="100%" fill="#ffffff" />
            <path d={qrSvg.path} fill="#0f172a" />
          </svg>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.shareStaffJoin}
            </h2>
          </div>

          <input
            ref={urlBoxRef}
            type="text"
            readOnly
            aria-label="Staff Join Link"
            data-share-url={shareUrl}
            value={shareUrl}
            onClick={(e) => e.currentTarget.select()}
            className="min-h-[44px] w-full rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2 font-mono text-xs text-slate-800 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400"
          />

          {copyError && (
            <p role="status" className="text-xs font-medium text-amber-800 dark:text-amber-300">
              {copyError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              aria-label={copied ? "Link Copied" : "Copy Link"}
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
                copied
                  ? "bg-emerald-700 text-white"
                  : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              }`}
            >
              {copied ? (
                <CheckReturnIcon className="h-3.5 w-3.5" />
              ) : (
                <CopyIcon className="h-3.5 w-3.5" />
              )}
              <span>{copied ? t.copied : t.copyLink}</span>
            </button>

            {onRotateInvite && (
              <button
                type="button"
                disabled={rotatingInvite}
                onClick={onRotateInvite}
                aria-label="Rotate Join Link"
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <ResetIcon className="h-3.5 w-3.5" />
                <span>{rotatingInvite ? t.rotating : t.newLink}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
