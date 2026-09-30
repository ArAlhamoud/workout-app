'use client';

// Every page of a PDF, stacked and scrollable, with zoom — drawn by pdf.js
// onto canvases (owner, 2026-09-30: "the in-app preview of the pdf does not
// allow me to zoom and see the next page").
//
// Why not an <iframe>: WKWebView's PDF plugin draws only the FIRST page of
// a PDF inside a frame, and the app disables pinch-zoom globally
// (layout.tsx viewport), so page 2 was unreachable and nothing could be
// enlarged. Here each page is its own canvas; zoom re-renders at a new
// WIDTH (no CSS transform — WKWebView fails to repaint transformed
// content, CLAUDE.md rule 3); the frame scrolls in both directions.
//
// pdf.js loads only when the viewer opens (dynamic import), and runs its
// parser on the main thread via the bundled worker module — a two-page
// report needs no separate worker file to be served.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { canvasDensity } from '@/lib/pdf-view';

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
  }>;
  destroy: () => Promise<void>;
};

async function loadPdf(bytes: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Registers globalThis.pdfjsWorker, which pdf.js uses as an in-page
  // ("fake") worker when no workerSrc is set.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  return (await task.promise) as unknown as PdfDoc;
}

export default function PdfPages({
  bytes,
  zoom,
  fallback,
}: {
  bytes: ArrayBuffer;
  zoom: number;
  /** Shown if pdf.js cannot load or parse here — the previous one-page
   *  viewer, so the worst case on an untested device is today's view. */
  fallback: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let live = true;
    let loaded: PdfDoc | null = null;
    loadPdf(bytes)
      .then((d) => {
        loaded = d;
        if (live) setDoc(d);
        else void d.destroy();
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (loaded) void loaded.destroy();
    };
  }, [bytes]);

  // Zoom keeps your place: scale the scroll offsets by the zoom ratio, so
  // zooming in on page 2 stays on page 2 (it jumped back to page 1). The
  // offsets come from the last scroll EVENT, not from the frame after the
  // resize: on zoom-out the browser clamps scrollTop to the shorter content
  // before this effect runs, which dropped the reader between pages.
  const prevZoom = useRef(zoom);
  const lastScroll = useRef({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const f = frame.current;
    const ratio = zoom / prevZoom.current;
    prevZoom.current = zoom;
    if (!f || ratio === 1) return;
    const { top, left } = lastScroll.current;
    const nextTop = Math.max(0, (top + f.clientHeight / 2) * ratio - f.clientHeight / 2);
    const nextLeft = Math.max(0, (left + f.clientWidth / 2) * ratio - f.clientWidth / 2);
    f.scrollTop = nextTop;
    f.scrollLeft = nextLeft;
    lastScroll.current = { top: f.scrollTop, left: f.scrollLeft };
  }, [zoom]);

  // Fit-to-width is measured, not guessed: the frame's own width.
  useEffect(() => {
    const measure = () => setWidth(frame.current?.clientWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (failed) return <>{fallback}</>;

  return (
    <div
      ref={frame}
      className="h-full w-full overflow-auto bg-gray-200"
      onScroll={(e) => {
        lastScroll.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft };
      }}
    >
      {!doc || !width ? (
        <p className="p-6 text-center text-sm text-app-tx3">Drawing the report…</p>
      ) : (
        <div className="space-y-3 p-2" style={{ width: `${Math.round((width - 16) * zoom) + 16}px` }}>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={`p${i + 1}-z${zoom}`} doc={doc} n={i + 1} cssWidth={Math.round((width - 16) * zoom)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({ doc, n, cssWidth }: { doc: PdfDoc; n: number; cssWidth: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssHeight, setCssHeight] = useState(Math.round(cssWidth * 1.414));

  useEffect(() => {
    let live = true;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const cssH = (cssWidth / base.width) * base.height;
      const dpr = canvasDensity(cssWidth, cssH, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const c = canvas.current;
      if (!live || !c) return;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      setCssHeight(Math.round(viewport.height / dpr));
      const ctx = c.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
    })().catch(() => {});
    const c = canvas.current;
    return () => {
      live = false;
      // Hand the pixels back now: Safari keeps a dropped canvas's backing
      // store until GC, and every zoom step replaces both pages.
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    };
  }, [doc, n, cssWidth]);

  return (
    <canvas
      ref={canvas}
      aria-label={`Page ${n}`}
      className="block bg-white shadow"
      style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
    />
  );
}
