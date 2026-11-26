"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { useClientOrigin } from "@/lib/client/storage";
import { CheckReturnIcon, CopyIcon } from "./Icons";

interface QrShareCardProps {
  sessionId: string;
}

const QR_MARGIN = 2;

export function QrShareCard({ sessionId }: QrShareCardProps) {
  const origin = useClientOrigin();
  const [copied, setCopied] = useState(false);

  const relativeJoinPath = `/s/${encodeURIComponent(sessionId)}`;
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
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      aria-label="Share Session Link and QR Code"
      className="min-w-0 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-2.5">
          <svg
            role="img"
            aria-label={`QR code to join exam session ${sessionId}`}
            data-qr-url={shareUrl}
            viewBox={qrSvg.viewBox}
            className="h-32 w-32"
            shapeRendering="crispEdges"
          >
            <rect width="100%" height="100%" fill="#ffffff" />
            <path d={qrSvg.path} fill="#0f172a" />
          </svg>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Staff QR &amp; Link
            </h2>
            <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-700">
              Scan to join
            </span>
          </div>
          <div
            data-share-url={shareUrl}
            className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2 font-mono text-xs break-all text-slate-700"
          >
            {shareUrl}
          </div>
          <button
            type="button"
            onClick={() => {
              void handleCopy();
            }}
            aria-label={copied ? "Link Copied" : "Copy Link"}
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition focus:ring-2 focus:ring-slate-400 focus:outline-none ${
              copied
                ? "bg-emerald-600 text-white"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {copied ? (
              <CheckReturnIcon className="h-3.5 w-3.5" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" />
            )}
            <span>{copied ? "Copied" : "Copy Link"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
