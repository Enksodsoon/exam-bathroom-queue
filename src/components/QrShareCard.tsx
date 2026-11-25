"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { useClientOrigin } from "@/lib/client/storage";

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
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-2">
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

        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-base font-semibold text-slate-900">
            Staff Join Link &amp; QR Code
          </h2>
          <p className="text-sm text-slate-600">
            Roaming staff scan this QR code or open the link below to join with
            their name only. Controller privileges are never included.
          </p>
          <div
            data-share-url={shareUrl}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm break-all text-slate-800"
          >
            {shareUrl}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus:ring-2 focus:ring-slate-500 focus:outline-none"
            >
              {copied ? "Link Copied" : "Copy Link"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
