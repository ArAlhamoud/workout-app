/**
 * Sizing rules for the in-app PDF viewer (src/components/health/PdfPages).
 * Pure, so the suite can check them without a browser.
 */

/** Zoom steps: fit-to-width, then 1.5×, 2×, 3×. */
export const ZOOMS = [1, 1.5, 2, 3] as const;

/**
 * Pixel budget per page canvas. iOS Safari/WKWebView draws a canvas over
 * ~16.7 M pixels as BLANK, and caps total canvas memory; 3× zoom on a 3×
 * screen came to ~16.3 M per page. 8 M keeps 3× sharp (≈2.1× density) and
 * two pages at ~64 MB.
 */
export const MAX_CANVAS_PIXELS = 8_000_000;

/** Device-pixel density for a page, capped by the pixel budget. */
export function canvasDensity(cssWidth: number, cssHeight: number, dpr: number): number {
  const area = Math.max(1, cssWidth * cssHeight);
  return Math.max(1, Math.min(dpr, 3, Math.sqrt(MAX_CANVAS_PIXELS / area)));
}
