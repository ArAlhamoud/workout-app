'use client';

// The PDF flow the owner asked for: tap → SEE the document first, in a
// full-screen in-app viewer with a proper header (safe-area padded — the
// bare webview navigation painted under the status bar), THEN share.
// Share hands the FILE to the system sheet via Web Share Level 2 (works
// in WKWebView, no native plugin); browsers without file-share get a
// plain download button instead.

import { useEffect, useState } from 'react';

const A4_PT = 595.28; // must match the route's page width

/** Shrink-only: full size on tablets/desktop, fit-to-width on phones. */
function pdfScale(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(1, window.innerWidth / A4_PT);
}

export default function PdfShareButton({ range }: { range: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);

  // The blob URL lives exactly as long as the viewer.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/health/report-pdf?range=${range}`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], `ar-health-report-${new Date().toISOString().slice(0, 10)}.pdf`, {
        type: 'application/pdf',
      });
      setPreview({ url: URL.createObjectURL(blob), file });
    } catch {
      setMsg('Could not build the PDF — try again.');
      setTimeout(() => setMsg(null), 2500);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!preview) return;
    if (navigator.canShare?.({ files: [preview.file] })) {
      try {
        await navigator.share({ files: [preview.file] });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    // No file-share (desktop): download instead.
    const a = document.createElement('a');
    a.href = preview.url;
    a.download = preview.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="flex-1 rounded-card border border-acc-cyan/40 bg-acc-cyan/10 py-2 text-center text-xs font-bold text-acc-cyan disabled:opacity-50"
      >
        {busy ? 'Building…' : 'PDF ↓'}
      </button>
      {msg && <p className="w-full text-center text-[11px] font-semibold text-rpe-hard">{msg}</p>}

      {/* z-[60]: the viewer is a full-screen modal — the journey bar
          (z-50) must not float over the document. */}
      {preview && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-app-bg">
          <div
            className="flex items-center justify-between gap-2 border-b-2 border-ink bg-app-surface px-4 pb-2.5"
            style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="min-h-[44px] px-1 text-sm font-bold text-app-tx2"
            >
              ← Close
            </button>
            <p className="text-sm font-extrabold text-app-tx1">Doctor Report</p>
            <button
              type="button"
              onClick={share}
              className="min-h-[44px] rounded-card border-2 border-ink bg-acc-teal-deep px-3.5 text-sm font-extrabold text-white shadow-[2px_2px_0_#0b0b0f] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#0b0b0f]"
            >
              Share
            </button>
          </div>
          {/* WKWebView's PDF plugin renders the A4 page (595pt) at 100% and
              clips the right column on a phone. No zoom API reaches the
              plugin, so fit-to-width is done by geometry: lay the frame out
              at true A4 width and scale it down to the viewport. */}
          <div className="flex-1 overflow-auto bg-white">
            <iframe
              src={preview.url}
              title="Doctor report PDF"
              className="border-0 bg-white"
              style={{
                width: `${A4_PT}px`,
                height: `${100 / pdfScale()}%`,
                transform: `scale(${pdfScale()})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
