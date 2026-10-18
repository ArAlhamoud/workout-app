// The doctor report PDF's writer: the page cursor, the row/section/note
// primitives and the two sections that grow with the data (the lab grid,
// the questions). Pulled out of the route so the suite can draw them with
// a fixture and PROVE they paginate — the route only wires data in.
//
// Standard-font PDFs speak WinAnsi only: EVERY string drawn here goes
// through pdfSafe (the suite fails on a drawText whose first argument is
// not pdfSafe(...)).

import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { pdfSafe, wrapLines } from './health-format';
import { labCellText, splitLabGrid, type LabGrid, type LabGridCell, type QuestionGroup } from './doctor-report';

export const A4: readonly [number, number] = [595.28, 841.89];
export const MARGIN = 56;

export const INK = rgb(0.04, 0.04, 0.06);
export const DIM = rgb(0.42, 0.42, 0.46);
export const LINE = rgb(0.85, 0.85, 0.87);
const SHADE = rgb(0.955, 0.955, 0.965);

type Color = ReturnType<typeof rgb>;

/** A section heading's own height plus the room `section()` keeps for
 *  its first rows by default. */
export const SECTION_NEED = 56;

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
  /** A ruled, upper-case section heading with room for what follows:
   *  `need` is the height of the heading plus its first content, so the
   *  heading is never alone at a page foot (review, 2026-10-18). */
  section(title: string, need?: number): void;
  /** A small bold heading inside a section (a question group). */
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
    section: (title, need = SECTION_NEED) => {
      // Room for the heading AND its first rows: a heading alone at the
      // foot of a page, its content on the next, reads as an empty section.
      ensure(Math.max(SECTION_NEED, need));
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

// ── The lab grid ─────────────────────────────────────────────

/** Date columns per PDF table; more dates split into "newest" / "earlier". */
export const PDF_LAB_COLUMNS_MAX = 4;
const GRID_HEADER_H = 16;
const GRID_ROW_H = 14;
const GRID_SUB_H = 9; // a cell's second line (own range / previous date)
const GRID_GROUP_H = 14;
const GRID_TITLE_H = 14;
const GRID_NOTE_H = 12;

/** What the Laboratory section needs before its heading is drawn: the
 *  heading, the note, a table title, the header row, a group row and one
 *  value row — so none of them is left alone at a page foot. */
export const LAB_SECTION_NEED = SECTION_NEED + GRID_NOTE_H + GRID_TITLE_H + GRID_HEADER_H + GRID_GROUP_H + GRID_ROW_H + GRID_SUB_H;
/** The questions section: heading, group subhead, one wrapped line. */
export const QUESTIONS_SECTION_NEED = SECTION_NEED + 42 + 14;

const truncate = (f: PDFFont, s: string, size: number, max: number): string => {
  let t = pdfSafe(s);
  if (f.widthOfTextAtSize(t, size) <= max) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return pdfSafe(`${t.trimEnd()}…`);
};

/**
 * One ruled grid per column chunk: the test-name column 30% wide, then a
 * column per draw, the dimmed previous column, and Ref; numbers right-
 * aligned; group rows shaded; the header row repeated on every page the
 * table runs onto; a group heading never orphaned at a page foot (room
 * for it and its first row is checked first). Returns rows drawn.
 */
export function drawLabGrid(w: PdfWriter, grid: LabGrid): number {
  const W = A4[0] - 2 * MARGIN;
  let drawn = 0;
  for (const part of splitLabGrid(grid, PDF_LAB_COLUMNS_MAX)) {
    const g = part.grid;
    const extra = (g.hasPrevious ? 1 : 0) + 1; // previous + Ref
    const nameW = Math.round(W * 0.3);
    const colW = (W - nameW) / (g.columns.length + extra);
    const xs: number[] = [MARGIN + nameW];
    for (let i = 1; i <= g.columns.length + extra; i++) xs.push(MARGIN + nameW + colW * i);
    const rowH = (r: { mixedLabs: boolean; previous: LabGridCell | null }) => GRID_ROW_H + (r.mixedLabs || r.previous ? GRID_SUB_H : 0);

    const header = () => {
      const top = w.y;
      w.page.drawLine({ start: { x: MARGIN, y: top + 2 }, end: { x: A4[0] - MARGIN, y: top + 2 }, thickness: 0.7, color: LINE });
      w.setY(top - 9);
      w.text('Test', 7.5, w.bold, DIM);
      const heads = [...g.columns.map((c) => c.label), ...(g.hasPrevious ? ['Previous'] : []), 'Ref'];
      heads.forEach((h, i) => {
        const t = truncate(w.bold, h, 7, colW - 4);
        const tw = w.bold.widthOfTextAtSize(t, 7);
        w.page.drawText(t, { x: xs[i + 1] - 2 - tw, y: w.y, size: 7, font: w.bold, color: DIM });
      });
      w.setY(top - GRID_HEADER_H);
      w.page.drawLine({ start: { x: MARGIN, y: w.y + 3 }, end: { x: A4[0] - MARGIN, y: w.y + 3 }, thickness: 0.4, color: LINE });
    };
    const cell = (c: LabGridCell | null, i: number, dim: boolean, sub: string | null) => {
      if (!c) return;
      const t = pdfSafe(labCellText(c));
      const f = c.newest ? w.bold : w.font;
      const tw = f.widthOfTextAtSize(t, 8);
      w.page.drawText(t, { x: xs[i + 1] - 2 - tw, y: w.y, size: 8, font: f, color: dim ? DIM : INK });
      if (sub) {
        const s = truncate(w.font, sub, 6.5, colW - 4);
        const sw = w.font.widthOfTextAtSize(s, 6.5);
        w.page.drawText(s, { x: xs[i + 1] - 2 - sw, y: w.y - GRID_SUB_H, size: 6.5, font: w.font, color: DIM });
      }
    };

    // Table title (only when split), then the header.
    w.ensure(GRID_TITLE_H + GRID_HEADER_H + GRID_GROUP_H + GRID_ROW_H + GRID_SUB_H);
    if (part.title) {
      w.text(part.title, 8, w.bold, DIM);
      w.setY(w.y - GRID_TITLE_H);
    }
    header();
    for (const group of g.groups) {
      // The group row and its first value row together, or a new page
      // (with the header again).
      const first = group.rows[0];
      const need = GRID_GROUP_H + (first ? rowH(first) : 0) + 4;
      if (w.y - need < MARGIN) {
        w.newPage();
        header();
      }
      const top = w.y;
      w.page.drawRectangle({ x: MARGIN, y: top - 11, width: W, height: GRID_GROUP_H - 1, color: SHADE });
      w.setY(top - 8);
      w.text(group.heading, 7.5, w.bold, DIM);
      w.setY(top - GRID_GROUP_H - 2);
      for (const r of group.rows) {
        const h = rowH(r);
        if (w.y - h - 2 < MARGIN) {
          w.newPage();
          header();
        }
        w.setY(w.y - 9);
        w.text(truncate(w.font, r.label, 8, nameW - 6), 8);
        r.cells.forEach((c, i) => cell(c, i, false, r.mixedLabs && c ? c.ref : null));
        if (g.hasPrevious) {
          const p = r.previous;
          cell(p, g.columns.length, true, p ? `${p.dayKey.slice(5).replace('-', '/')} · ${p.lab}${r.mixedLabs && p.ref ? ` · ${p.ref}` : ''}` : null);
        }
        if (r.ref) {
          const t = truncate(w.font, r.ref, 7, colW - 4);
          const tw = w.font.widthOfTextAtSize(t, 7);
          w.page.drawText(t, { x: xs[xs.length - 1] - 2 - tw, y: w.y, size: 7, font: w.font, color: DIM });
        }
        w.setY(w.y - (h - 9));
        w.page.drawLine({ start: { x: MARGIN, y: w.y + 3 }, end: { x: A4[0] - MARGIN, y: w.y + 3 }, thickness: 0.3, color: LINE });
        drawn++;
      }
    }
    w.setY(w.y - 8);
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
