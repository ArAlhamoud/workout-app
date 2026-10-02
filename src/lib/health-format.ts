// Health screens — the words around the numbers.
//
// Pure formatting shared by the doctor report (page AND PDF), Patterns and
// the Journey, so one fact cannot be worded two ways (audit, 2026-10-02:
// the page and the PDF each carried their own signedKg, their own age and
// their own CPAP adherence sentence). No arithmetic over logs lives here —
// that is src/lib/health-insights.ts.

import { ownerDayKey } from './health-insights';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08" → "Aug 2026". A month key is not a label (Patterns printed
 *  the raw key). Built from the key itself: no Date, so no time zone. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : key;
}

/** "29 Sep" / "Sep 27" from a Riyadh day key (YYYY-MM-DD). */
const dayMonth = (key: string, monthFirst: boolean): string => {
  const [, mm, dd] = key.split('-');
  const month = MONTHS[Number(mm) - 1] ?? mm;
  return monthFirst ? `${month} ${Number(dd)}` : `${Number(dd)} ${month}`;
};

/**
 * "7 Sep" — the ONE short day label for charts and Patterns. The month
 * comes from the table above, not from the runtime: `toLocaleDateString`
 * with en-GB prints "Sept" on a newer ICU and "Sep" on an older one, so
 * the weekly axis read "10 Sept" beside "Sep" everywhere else
 * (2026-10-02). The time zone is always said: Asia/Riyadh for an instant,
 * UTC for a row stored as a bare day.
 */
export function shortDay(d: Date | number | string, timeZone: string): string {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  return dayMonth(key, false);
}

// ── Weight ───────────────────────────────────────────────────

/**
 * The change since the first clinic visit, signs agreeing: a loss is minus
 * in BOTH figures, a regain plus in both, zero is "0 kg (0%)". The report
 * printed "−0 kg" for no change and "+1.5 kg (-1.1%)" for a regain — the
 * kg sign was flipped for display and the percent was not (2026-10-02).
 * `minus` is "−" on the page and "-" in the PDF.
 */
export function weightChangeLabel(lostKg: number, pctLost: number, minus = '−'): string {
  const sign = changeSign(lostKg, minus);
  // The percent takes the kg's sign; a change too small to show as a
  // percent prints an unsigned 0.
  const pct = Math.abs(pctLost);
  return `${signedKg(lostKg, minus)} kg (${pct === 0 ? '' : sign}${pct}%)`;
}

const changeSign = (lostKg: number, minus: string) => (lostKg > 0 ? minus : lostKg < 0 ? '+' : '');

/** The kg figure alone, signed as a CHANGE: "−8", "+1.5", "0" (never "−0"). */
export function signedKg(lostKg: number, minus = '−'): string {
  return `${changeSign(lostKg, minus)}${Math.abs(lostKg)}`;
}

/** The same fact for the Arabic summary: the WORD carries the direction,
 *  so both numbers print unsigned ("زيادة 1.5 كجم، 1.1٪", never "-1.1٪"). */
export function weightChangeAr(lostKg: number, pctLost: number): string {
  if (lostKg === 0) return 'بلا تغيير';
  return `${lostKg > 0 ? 'نقص' : 'زيادة'} ${Math.abs(lostKg)} كجم، ${Math.abs(pctLost)}٪`;
}

/**
 * The latest weight, without claiming a day it was not measured on. The
 * Journey said "125 kg today" on 2 Oct for a weigh-in from 27 Sep
 * (2026-10-02). "today" only when the weigh-in is from his calendar today.
 */
export function weighInLabel(kg: number, at: Date | string, now: Date = new Date()): string {
  const day = ownerDayKey(new Date(at));
  return day === ownerDayKey(now) ? `${kg} kg today` : `${kg} kg · ${dayMonth(day, true)}`;
}

// ── Doctor report ────────────────────────────────────────────

const BIRTH_YEAR = 1988;

/**
 * Age for the report's patient block. The report printed `year − 1988` as
 * an exact age, a year too old until the birthday (2026-10-02). With a
 * stored birth date the age respects it (his calendar day); without one —
 * the profile stores only what the owner gave, the year — it prints both
 * candidates rather than pick one.
 */
export function reportAge(birthDate: unknown, now: Date = new Date()): string {
  const [y, m, d] = ownerDayKey(now).split('-').map(Number);
  const b = typeof birthDate === 'string' || birthDate instanceof Date ? new Date(birthDate) : null;
  if (b && !Number.isNaN(b.getTime())) {
    // A birth date is a calendar date, stored date-only (UTC midnight).
    const had = m > b.getUTCMonth() + 1 || (m === b.getUTCMonth() + 1 && d >= b.getUTCDate());
    return `${y - b.getUTCFullYear() - (had ? 0 : 1)} y`;
  }
  return `${y - BIRTH_YEAR - 1}–${y - BIRTH_YEAR} y`;
}

/** "23 of 25 reported (92%) · through 29 Sep" — the denominator is named
 *  and dated so a doctor does not read unreported nights as unused. */
export function cpapAdherenceLabel(a: {
  used: number;
  reported: number;
  pct: number | null;
  through: Date | null;
}): string {
  const base = `${a.used} of ${a.reported} reported${a.pct != null ? ` (${a.pct}%)` : ''}`;
  // Night rows are keyed by the morning they ended, at UTC midnight.
  return a.through ? `${base} · through ${dayMonth(a.through.toISOString().slice(0, 10), false)}` : base;
}

// ── PDF text (standard fonts speak WinAnsi only) ─────────────

/** Plain equivalents for what a med name, dose, frequency, condition or
 *  lab unit commonly carries. Anything else unencodable becomes "?". */
const PDF_MAP: Record<string, string> = {
  '−': '-', '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-',
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '∼': '~',
  '→': '->', '←': '<-', '↑': '^', '↓': 'v',
  'μ': 'µ', // Greek mu → the micro sign, which WinAnsi has (µmol/L)
  '′': "'", '″': '"', '⁄': '/', '∕': '/',
  '\t': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '٫': '.', '٬': ',', '٪': '%',
};
const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';
const SUPERSCRIPT_EXTRA = '⁰ⁱ⁲⁳⁴⁵⁶⁷⁸⁹'; // ¹²³ are WinAnsi already
/** The cp1252 characters above Latin-1 (0x80–0x9F), all in Helvetica. */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** Zero-width and direction marks: they carry no glyph, so they vanish. */
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿­]/g;

const winAnsi = (ch: string): boolean => {
  const c = ch.codePointAt(0) as number;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch);
};

/**
 * Text pdf-lib's standard fonts can ALWAYS draw. `drawText` throws on the
 * first character outside WinAnsi, so one "≈", Greek "μ", non-breaking
 * hyphen or Arabic letter in a med name, dose or lab unit returned 500 for
 * the whole report (2026-10-02). Total by construction: map what has a
 * plain equivalent, then replace whatever is left with "?" — a visible
 * gap the reader can ask about beats no report.
 */
export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of s.replace(INVISIBLE, '')) {
    const mapped = PDF_MAP[ch];
    if (mapped !== undefined) out += mapped;
    else if (winAnsi(ch)) out += ch;
    else if (SUBSCRIPT.includes(ch)) out += String(SUBSCRIPT.indexOf(ch));
    else if (SUPERSCRIPT_EXTRA.includes(ch)) out += String(SUPERSCRIPT_EXTRA.indexOf(ch));
    else if (ch >= '٠' && ch <= '٩') out += String(ch.charCodeAt(0) - 0x660); // Arabic-Indic digits
    else if (ch === '\n' || ch === '\r') out += ' ';
    else out += '?';
  }
  return out;
}

/**
 * Greedy word wrap against a measured width. The PDF's conditions line was
 * one unwrapped line (433 of 483 pt on 2026-10-02 — one more diagnosis and
 * it ran off the page). A single word wider than the line keeps its own
 * line rather than being cut; leading indentation is kept on every line.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const indent = /^ */.exec(text)?.[0] ?? '';
  const lines: string[] = [];
  let line = '';
  for (const word of text.slice(indent.length).split(' ')) {
    const next = line ? `${line} ${word}` : `${indent}${word}`;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = `${indent}${word}`;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}
