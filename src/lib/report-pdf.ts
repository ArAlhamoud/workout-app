// The doctor report PDF's writer: the page cursor, the row/section/note
// primitives and the two sections that grow with the data (the lab table,
// the questions). Pulled out of the route so the suite can draw them with
// a fixture and PROVE they paginate — the route only wires data in.
//
// Standard-font PDFs speak WinAnsi only: EVERY string drawn here goes
// through pdfSafe (the suite fails on a drawText whose first argument is
// not pdfSafe(...)).

import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { pdfSafe, wrapLines } from './health-format';
import type { LabTableGroup, QuestionGroup } from './doctor-report';

export const A4: readonly [number, number] = [595.28, 841.89];
export const MARGIN = 56;

export const INK = rgb(0.04, 0.04, 0.06);
export const DIM = rgb(0.42, 0.42, 0.46);
export const LINE = rgb(0.85, 0.85, 0.87);

type Color = ReturnType<typeof rgb>;

export interface PdfWriter {
  readonly font: PDFFont;
  readonly bold: PDFFont;
  /** The page the cursor is on — re-read after every call, a page break
   *  replaces it. */
  readonly page: PDFPage;
  readonly y: number;
  setY(y: number): void;
  /** A new page when `need` points do not fit above the bottom margin. */
  ensure(need: number): void;
  newPage(): void;
  text(t: string, size: number, f?: PDFFont, color?: Color, x?: number): void;
  /** Label left, value right, one line. */
  row(label: string, value: string, dim?: boolean): void;
  /** A ruled, upper-case section heading with room for its first rows. */
  section(title: string): void;
  /** A small bold heading inside a section (a lab group, a question group). */
  subhead(title: string): void;
  /** A dim note, wrapped inside the margins. */
  note(t: string): void;
  /** Body text, wrapped; each line keeps the indent of the first. */
  lines(t: string, size: number, f?: PDFFont, color?: Color): void;
}

export function createPdfWriter(doc: PDFDocument, font: PDFFont, bold: PDFFont): PdfWriter {
  const W = A4[0] - 2 * MARGIN;
  let page = doc.addPage([A4[0], A4[1]]);
  let y = A4[1] - MARGIN;
  const newPage = () => {
    page = doc.addPage([A4[0], A4[1]]);
    y = A4[1] - MARGIN;
  };
  const ensure = (need: number) => {
    if (y - need < MARGIN) newPage();
  };
  const text = (t: string, size: number, f: PDFFont = font, color: Color = INK, x: number = MARGIN) =>
    page.drawText(pdfSafe(t), { x, y, size, font: f, color });
  const lines = (t: string, size: number, f: PDFFont = font, color: Color = INK) => {
    for (const line of wrapLines(pdfSafe(t), W, (s) => f.widthOfTextAtSize(s, size))) {
      ensure(size + 5);
      text(line, size, f, color);
      y -= size + 3.5;
    }
  };
  return {
    font,
    bold,
    get page() { return page; },
    get y() { return y; },
    setY: (v) => { y = v; },
    ensure,
    newPage,
    text,
    // Compact rhythm so the written report fits page 1 and the charts get
    // page 2 (owner, 2026-09-30: "two pages, one normal, one the graphs").
    row: (label, value, dim = false) => {
      ensure(15);
      text(label, 9.5, font, DIM);
      const w = bold.widthOfTextAtSize(pdfSafe(value), 9.5);
      page.drawText(pdfSafe(value), { x: A4[0] - MARGIN - w, y, size: 9.5, font: bold, color: dim ? DIM : INK });
      y -= 13.5;
    },
    section: (title) => {
      // Room for the heading AND its first rows: a heading alone at the
      // foot of a page, its content on the next, reads as an empty section.
      ensure(56);
      y -= 6;
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: A4[0] - MARGIN, y: y + 4 }, thickness: 0.7, color: LINE });
      y -= 11;
      text(title.toUpperCase(), 8.5, bold, DIM);
      y -= 13;
    },
    subhead: (title) => {
      ensure(42);
      y -= 3;
      text(title, 8, bold, DIM);
      y -= 12;
    },
    note: (t) => lines(t, 8.5, font, DIM),
    lines,
  };
}

/**
 * The lab table: a group heading, then per test its name and one row per
 * draw — date and lab on the left, value, unit, the neutral mark and the
 * draw's own range on the right; the "previous" draw (behind the range)
 * dimmed. Returns the number of rows drawn.
 */
export function drawLabTable(w: PdfWriter, groups: LabTableGroup[], fmtDate: (d: Date | string) => string): number {
  let drawn = 0;
  for (const g of groups) {
    w.subhead(g.heading);
    for (const t of g.tests) {
      w.ensure(30);
      w.text(t.label, 9.5, w.bold);
      w.setY(w.y - 12);
      for (const r of t.rows) {
        w.row(
          `${fmtDate(r.date)} · ${r.lab}${r.previous ? ' · previous' : ''}`,
          `${r.value} ${r.unit}${r.flag ? ` ${r.flag}` : ''}${r.ref ? ` (${r.ref})` : ''}`,
          r.previous,
        );
        drawn++;
      }
    }
  }
  return drawn;
}

/** The owner's open questions, grouped and numbered, wrapped as body
 *  text. Returns the number of questions drawn. */
export function drawQuestions(w: PdfWriter, groups: QuestionGroup[]): number {
  let drawn = 0;
  for (const g of groups) {
    w.subhead(g.label);
    for (const q of g.items) {
      w.lines(`${q.n}. ${q.text}`, 9.5);
      w.setY(w.y - 3);
      drawn++;
    }
  }
  return drawn;
}
