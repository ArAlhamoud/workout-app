'use client';

// The PDF button, done right for the shell: navigating a WKWebView to a
// PDF is a dead end — it paints under the status bar with no zoom, no
// share, no way back. Instead: fetch the bytes, hand the FILE to the
// system share sheet (Web Share Level 2 — supported in WKWebView, no
// native plugin needed). Quick Look, WhatsApp, AirDrop, Save to Files
// all come free. Browsers without file-share get a plain download.

import { useState } from 'react';

export default function PdfShareButton({ range }: { range: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const share = async () => {
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
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          // User closed the sheet — not an error worth a message.
          if ((e as Error).name === 'AbortError') return;
          // NotAllowedError (lost gesture) falls through to download.
        }
      }
      // Fallback: a plain download (desktop browsers, old iOS).
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setMsg('Could not build the PDF — try again.');
      setTimeout(() => setMsg(null), 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={share}
        disabled={busy}
        className="flex-1 rounded-card border border-acc-cyan/40 bg-acc-cyan/10 py-2 text-center text-xs font-bold text-acc-cyan disabled:opacity-50"
      >
        {busy ? 'Building…' : 'PDF ↓'}
      </button>
      {msg && <p className="w-full text-center text-[11px] font-semibold text-rpe-hard">{msg}</p>}
    </>
  );
}
