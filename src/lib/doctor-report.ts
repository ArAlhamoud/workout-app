// The doctor report's visit pack (owner, 2026-10-18): the pure arithmetic
// and wording behind the sections the report page and the PDF both print.
// ONE function per section — the two renderers call the same one, so they
// can never disagree (the lesson of health-format.ts, 2026-10-02).
//
// Tracker, not diagnostic (docs/HEALTH.md): counts beside every average,
// "too few" under three readings, a lab's OWN range beside its value and a
// neutral mark outside it. Nothing here grades a number or names a drug,
// a dose or a test — the owner's questions below are his words, quoted.

import { labRefLabel, ownerActivityDayUtc, ownerDayKey } from './health-insights';
import { signedKg } from './health-format';

const DAY_MS = 86_400_000;

// ── The range ────────────────────────────────────────────────

export const REPORT_RANGES = { '4w': 28, '3m': 91, all: 100_000 } as const;
export type ReportRange = keyof typeof REPORT_RANGES;

/**
 * Where the selected range starts: N of HIS days back from his activity
 * day, at that day's UTC midnight (the instant day rows sit at). The
 * report used `Date.now() − N days`, the server's clock: for three hours
 * each night the window ended on a different day than the header said.
 */
export function reportSince(range: ReportRange, now: Date = new Date()): Date {
  return new Date(ownerActivityDayUtc(now).getTime() - REPORT_RANGES[range] * DAY_MS);
}

export interface ReportRow {
  label: string;
  value: string;
  dim?: boolean;
}

// ── Questions for the doctor ─────────────────────────────────

export type QuestionFor = 'cardiology' | 'endocrinology' | 'general';
export const QUESTION_FOR: readonly QuestionFor[] = ['cardiology', 'endocrinology', 'general'];
export const QUESTION_FOR_LABEL: Record<QuestionFor, string> = {
  cardiology: 'Cardiology',
  endocrinology: 'Endocrinology',
  general: 'General',
};

export interface DoctorQuestion {
  id: string;
  text: string;
  for: QuestionFor;
  /** His day key (YYYY-MM-DD) once asked; null while open. */
  askedOn: string | null;
  answer: string | null;
  createdAt: string;
}

const MAX_QUESTIONS = 60;
const MAX_TEXT = 500;

const isFor = (v: unknown): v is QuestionFor => (QUESTION_FOR as readonly string[]).includes(v as string);

/** The stored column, read tolerantly: a malformed entry is dropped, never
 *  thrown on — the report must print whatever else is there. */
export function doctorQuestions(raw: unknown): DoctorQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: DoctorQuestion[] = [];
  const seen = new Set<string>();
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue;
    const o = q as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, MAX_TEXT) : '';
    if (!text || typeof o.id !== 'string' || !o.id || seen.has(o.id) || !isFor(o.for)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      text,
      for: o.for,
      askedOn: typeof o.askedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.askedOn) ? o.askedOn : null,
      answer: typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim().slice(0, MAX_TEXT) : null,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

export interface QuestionGroup {
  for: QuestionFor;
  label: string;
  items: Array<{ n: number; id: string; text: string }>;
}

/** The open questions, grouped in the fixed order and numbered straight
 *  through, as the report's last section prints them. */
export function openQuestionGroups(questions: DoctorQuestion[]): QuestionGroup[] {
  let n = 0;
  const groups: QuestionGroup[] = [];
  for (const f of QUESTION_FOR) {
    const items = questions
      .filter((q) => q.for === f && q.askedOn === null)
      .map((q) => ({ n: ++n, id: q.id, text: q.text }));
    if (items.length) groups.push({ for: f, label: QUESTION_FOR_LABEL[f], items });
  }
  return groups;
}

export function openQuestionCount(questions: DoctorQuestion[]): number {
  return questions.filter((q) => q.askedOn === null).length;
}

export function addQuestion(
  list: DoctorQuestion[],
  q: { id: string; text: string; for: QuestionFor },
  now: Date = new Date(),
): DoctorQuestion[] {
  const text = q.text.trim().slice(0, MAX_TEXT);
  if (!text || !isFor(q.for) || list.length >= MAX_QUESTIONS || list.some((x) => x.id === q.id)) return list;
  return [...list, { id: q.id, text, for: q.for, askedOn: null, answer: null, createdAt: now.toISOString() }];
}

/** Text, who it is for and the one-line answer; an empty text keeps the
 *  old one (a cleared field is not a request to lose the question). */
export function editQuestion(
  list: DoctorQuestion[],
  id: string,
  patch: { text?: string; for?: QuestionFor; answer?: string | null },
): DoctorQuestion[] {
  return list.map((q) => {
    if (q.id !== id) return q;
    const text = patch.text?.trim().slice(0, MAX_TEXT);
    const answer = patch.answer === undefined ? q.answer : patch.answer?.trim().slice(0, MAX_TEXT) || null;
    return { ...q, text: text || q.text, for: isFor(patch.for) ? patch.for : q.for, answer };
  });
}

/** Asked = HIS today as a day key; null re-opens it. */
export function markQuestionAsked(list: DoctorQuestion[], id: string, when: Date | null): DoctorQuestion[] {
  return list.map((q) => (q.id === id ? { ...q, askedOn: when ? ownerDayKey(when) : null } : q));
}

export function removeQuestion(list: DoctorQuestion[], id: string): DoctorQuestion[] {
  return list.filter((q) => q.id !== id);
}

// ── Blood pressure control ───────────────────────────────────

/**
 * The line the report counts readings against: 130/80, a common clinic target
 * for treated hypertension that the owner and his doctor recognise — and
 * NOT the app's judgement of his pressure (law 3: never a threshold the
 * app invented). The report prints "N of M at or over it" and nothing more.
 */
export const BP_CONTROL_THRESHOLD = { systolic: 130, diastolic: 80 } as const;

export interface BpReadingLite {
  at: Date | string;
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  context?: string | null;
}

interface ContextAverage {
  n: number;
  systolic: number | null;
  diastolic: number | null;
}

export interface BpControl {
  n: number;
  /** Readings with systolic ≥ 130 OR diastolic ≥ 80. */
  over: number;
  highest: { systolic: number; diastolic: number; at: Date | string } | null;
  lowest: { systolic: number; diastolic: number; at: Date | string } | null;
  morning: ContextAverage;
  evening: ContextAverage;
}

const MIN_FOR_AVERAGE = 3;

const contextAverage = (rows: BpReadingLite[]): ContextAverage =>
  rows.length >= MIN_FOR_AVERAGE
    ? {
        n: rows.length,
        systolic: Math.round(rows.reduce((s, r) => s + r.systolic, 0) / rows.length),
        diastolic: Math.round(rows.reduce((s, r) => s + r.diastolic, 0) / rows.length),
      }
    : { n: rows.length, systolic: null, diastolic: null };

/** Over the readings handed in (the caller has already cut the range). */
export function bpControl(readings: BpReadingLite[]): BpControl {
  const higher = (a: BpReadingLite, b: BpReadingLite) =>
    a.systolic !== b.systolic ? a.systolic - b.systolic : a.diastolic - b.diastolic;
  let highest: BpReadingLite | null = null;
  let lowest: BpReadingLite | null = null;
  let over = 0;
  for (const r of readings) {
    if (r.systolic >= BP_CONTROL_THRESHOLD.systolic || r.diastolic >= BP_CONTROL_THRESHOLD.diastolic) over++;
    if (!highest || higher(r, highest) > 0) highest = r;
    if (!lowest || higher(r, lowest) < 0) lowest = r;
  }
  const pick = (r: BpReadingLite | null) => (r ? { systolic: r.systolic, diastolic: r.diastolic, at: r.at } : null);
  return {
    n: readings.length,
    over,
    highest: pick(highest),
    lowest: pick(lowest),
    morning: contextAverage(readings.filter((r) => r.context === 'morning')),
    evening: contextAverage(readings.filter((r) => r.context === 'evening')),
  };
}

const bpPair = (s: number, d: number) => `${s}/${d}`;

/** The rows under the average, for the page and the PDF alike. The split
 *  prints only when BOTH contexts have a reading in the range; a context
 *  under three readings keeps its count and says so. */
export function bpControlRows(c: BpControl, fmtDate: (d: Date | string) => string): ReportRow[] {
  if (c.n === 0) return [];
  const rows: ReportRow[] = [
    { label: `Readings ≥ ${BP_CONTROL_THRESHOLD.systolic}/${BP_CONTROL_THRESHOLD.diastolic}`, value: `${c.over} of ${c.n}` },
  ];
  if (c.highest) rows.push({ label: 'Highest', value: `${bpPair(c.highest.systolic, c.highest.diastolic)} · ${fmtDate(c.highest.at)}` });
  if (c.lowest) rows.push({ label: 'Lowest', value: `${bpPair(c.lowest.systolic, c.lowest.diastolic)} · ${fmtDate(c.lowest.at)}` });
  if (c.morning.n > 0 && c.evening.n > 0) {
    for (const [label, a] of [['Morning', c.morning], ['Evening', c.evening]] as const) {
      rows.push({
        label: `${label} · ${a.n} reading${a.n === 1 ? '' : 's'}`,
        value: a.systolic != null && a.diastolic != null ? bpPair(a.systolic, a.diastolic) : 'too few for an average',
        dim: a.systolic == null,
      });
    }
  }
  return rows;
}

export interface PulseTrend {
  current: { avg: number; n: number } | null;
  previous: { avg: number; n: number } | null;
}

/** Average pulse over the last `days` vs the same-length window before
 *  it. Three pulses or null on either side; "All" has no window before
 *  it. Two numbers, no verdict — the doctor reads the pair. */
export function pulseTrend(readings: BpReadingLite[], days: number, now: Date = new Date()): PulseTrend {
  const t = now.getTime();
  const win = days * DAY_MS;
  const avg = (rows: number[]) =>
    rows.length >= MIN_FOR_AVERAGE ? { avg: Math.round(rows.reduce((s, p) => s + p, 0) / rows.length), n: rows.length } : null;
  const current: number[] = [];
  const previous: number[] = [];
  for (const r of readings) {
    if (r.pulse == null) continue;
    const age = t - new Date(r.at).getTime();
    if (age < 0) continue;
    if (age <= win) current.push(r.pulse);
    else if (age <= 2 * win) previous.push(r.pulse);
  }
  return { current: avg(current), previous: days >= REPORT_RANGES.all ? null : avg(previous) };
}

export function pulseRows(p: PulseTrend, days: number): ReportRow[] {
  const rows: ReportRow[] = [];
  if (p.current) rows.push({ label: `Pulse · ${p.current.n} readings`, value: `${p.current.avg} bpm` });
  if (p.previous) rows.push({ label: `Pulse, previous ${days} days · ${p.previous.n} readings`, value: `${p.previous.avg} bpm` });
  return rows;
}

// ── Weight in clinical terms ─────────────────────────────────

export interface WeightWindowPace {
  kgPerWeek: number;
  /** Per week, as a share of the first weigh-in in the window. */
  pctPerWeek: number;
  n: number;
  /** Weeks between the first and the last weigh-in, one decimal. */
  weeks: number;
}

// Half away from zero: Math.round(-87.5) is -87, and a loss of 0.875
// kg/week would have printed as 0.87 beside a gain of 0.875 as 0.88.
const roundTo = (n: number, k: number) => Math.sign(n) * Math.round(Math.abs(n) * k) / k;
const round2 = (n: number) => roundTo(n, 100);
const round1 = (n: number) => roundTo(n, 10);

/** First to last weigh-in in the window, per week. Two weigh-ins at
 *  least a week apart, or null — a shorter span is water, not a pace. */
export function weightWindowPace(
  weights: Array<{ date: Date | string; weight: number | null }>,
): WeightWindowPace | null {
  const rows = weights
    .filter((w): w is { date: Date | string; weight: number } => w.weight != null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / DAY_MS;
  if (days < 7) return null;
  const weeks = days / 7;
  const kgPerWeek = (last.weight - first.weight) / weeks;
  return {
    kgPerWeek: round2(kgPerWeek),
    pctPerWeek: round2((kgPerWeek / first.weight) * 100),
    n: rows.length,
    weeks: round1(weeks),
  };
}

const signed = (v: number, minus: string) => `${v > 0 ? '+' : v < 0 ? minus : ''}${Math.abs(v)}`;

/**
 * The Weight section's window rows: the change over the range (the one
 * signed formatter — the page printed "-3.4 kg" here beside "−8 kg"
 * above it), the share of body weight lost since the first clinic visit,
 * the pace in kg and % per week, and the weeks on treatment. Numbers
 * only. `minus` is "−" on the page and "-" in the PDF.
 */
export function weightWindowRows(
  input: {
    weights: Array<{ date: Date | string; weight: number | null }>;
    rangeLabel: string;
    treatmentWeek: number | null;
    pctLost: number;
  },
  minus = '−',
): ReportRow[] {
  const rows: ReportRow[] = [];
  const ws = input.weights
    .filter((w): w is { date: Date | string; weight: number } => w.weight != null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (ws.length >= 2) {
    const delta = round1(ws[ws.length - 1].weight - ws[0].weight);
    rows.push({ label: input.rangeLabel, value: `${signedKg(-delta, minus)} kg · ${ws.length} weigh-ins` });
  }
  rows.push({ label: 'Of body weight at first clinic visit', value: `${signedKg(input.pctLost, minus)}%` });
  const pace = weightWindowPace(ws);
  if (pace) {
    rows.push({
      label: `Pace · ${pace.weeks} weeks`,
      value: `${signed(pace.kgPerWeek, minus)} kg/week · ${signed(pace.pctPerWeek, minus)}%/week`,
    });
  }
  if (input.treatmentWeek != null) rows.push({ label: 'Weeks on treatment', value: String(input.treatmentWeek) });
  return rows;
}

// ── Laboratory ───────────────────────────────────────────────

/** The owner's order and headings (2026-10-18). Anything else → Other. */
export const LAB_GROUPS: ReadonlyArray<{ heading: string; tests: readonly string[] }> = [
  { heading: 'Lipids', tests: ['total-chol', 'ldl', 'hdl', 'non-hdl-chol', 'chol-hdl-ratio', 'triglycerides', 'lp(a)', 'apob'] },
  { heading: 'Glucose', tests: ['hba1c', 'glucose'] },
  { heading: 'Inflammation', tests: ['crp', 'esr'] },
  { heading: 'Cardiac', tests: ['troponin-i-hs'] },
  { heading: 'Kidney', tests: ['creatinine', 'egfr', 'urea', 'uric-acid'] },
  { heading: 'Liver', tests: ['alt', 'ast', 'ggt', 'bilirubin-total', 'albumin', 'protein-total'] },
  { heading: 'Electrolytes & minerals', tests: ['sodium', 'potassium', 'chloride', 'calcium', 'corrected calcium', 'magnesium'] },
  { heading: 'Thyroid', tests: ['tsh', 'ft3', 'ft4'] },
  { heading: 'Blood count', tests: ['haemoglobin', 'haematocrit', 'rbc', 'mcv', 'mch', 'mchc', 'rdw', 'platelets', 'mpv', 'wbc', 'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils'] },
  { heading: 'Iron & vitamins', tests: ['iron', 'ferritin', 'folate', 'vitamin-d'] },
  { heading: 'Hormones', tests: ['renin', 'aldosterone'] },
];

export const LAB_TEST_LABEL: Record<string, string> = {
  'total-chol': 'Total cholesterol', ldl: 'LDL', hdl: 'HDL', 'non-hdl-chol': 'Non-HDL cholesterol',
  'chol-hdl-ratio': 'Cholesterol / HDL ratio', triglycerides: 'Triglycerides', 'lp(a)': 'Lp(a)', apob: 'ApoB',
  hba1c: 'HbA1c', glucose: 'Glucose',
  crp: 'CRP', esr: 'ESR',
  'troponin-i-hs': 'Troponin I (hs)',
  creatinine: 'Creatinine', egfr: 'eGFR', urea: 'Urea', 'uric-acid': 'Uric acid',
  alt: 'ALT', ast: 'AST', ggt: 'GGT', 'bilirubin-total': 'Bilirubin (total)', albumin: 'Albumin', 'protein-total': 'Protein (total)',
  sodium: 'Sodium', potassium: 'Potassium', chloride: 'Chloride', calcium: 'Calcium', 'corrected calcium': 'Corrected calcium', magnesium: 'Magnesium',
  tsh: 'TSH', ft3: 'FT3', ft4: 'FT4',
  haemoglobin: 'Haemoglobin', haematocrit: 'Haematocrit', rbc: 'RBC', mcv: 'MCV', mch: 'MCH', mchc: 'MCHC', rdw: 'RDW',
  platelets: 'Platelets', mpv: 'MPV', wbc: 'WBC', neutrophils: 'Neutrophils', lymphocytes: 'Lymphocytes',
  monocytes: 'Monocytes', eosinophils: 'Eosinophils', basophils: 'Basophils',
  iron: 'Iron', ferritin: 'Ferritin', folate: 'Folate', 'vitamin-d': 'Vitamin D',
  renin: 'Renin', aldosterone: 'Aldosterone',
};

const LAB_LABEL_MAX = 14;

/**
 * The lab, short, beside every value — reference ranges differ between
 * labs, so a value without its lab is a value without its range. Three
 * known labs under whatever name the row carries; anything else prints
 * its own name, truncated; no lab prints a dash.
 */
export function labShortLabel(lab: string | null | undefined): string {
  const s = (lab ?? '').trim();
  if (!s) return '—';
  if (/al\s*habib/i.test(s)) return 'Al Habib';
  if (/biolab/i.test(s)) return 'Biolab';
  if (/al\s*ghadeer/i.test(s)) return 'AlGhadeer';
  return s.length > LAB_LABEL_MAX ? `${s.slice(0, LAB_LABEL_MAX).trimEnd()}…` : s;
}

/** A neutral mark outside the lab's OWN range: ▲ above, ▼ below, nothing
 *  on or inside the bounds. A mark, not a word — the doctor reads it. */
export function labFlag(l: { value: number; refLow: number | null; refHigh: number | null }): '▲' | '▼' | '' {
  if (l.refHigh != null && l.value > l.refHigh) return '▲';
  if (l.refLow != null && l.value < l.refLow) return '▼';
  return '';
}

export interface LabRowLite {
  id: string;
  date: Date | string;
  test: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  lab: string | null;
}

export interface LabTableRow {
  id: string;
  date: Date | string;
  value: number;
  unit: string;
  lab: string;
  ref: string;
  flag: '▲' | '▼' | '';
  /** The most recent draw BEFORE the range, shown for the trend. */
  previous: boolean;
}

export interface LabTableTest {
  test: string;
  label: string;
  rows: LabTableRow[];
}

export interface LabTableGroup {
  heading: string;
  tests: LabTableTest[];
}

/**
 * Every draw in the range, per test, oldest first, each with ITS lab and
 * ITS range (law 3: a range belongs to its draw) — and, behind the range,
 * the most recent earlier value as "previous". A test with no draw in
 * the range does not print. Units are shown as stored, never converted.
 */
export function labTable(labs: LabRowLite[], since: Date): LabTableGroup[] {
  const t0 = since.getTime();
  const byTest = new Map<string, LabRowLite[]>();
  for (const l of labs) {
    const key = l.test.trim().toLowerCase();
    const list = byTest.get(key) ?? [];
    list.push(l);
    byTest.set(key, list);
  }
  const toRow = (l: LabRowLite, previous: boolean): LabTableRow => ({
    id: l.id, date: l.date, value: l.value, unit: l.unit, lab: labShortLabel(l.lab), ref: labRefLabel(l), flag: labFlag(l), previous,
  });
  const build = (key: string): LabTableTest | null => {
    const rows = [...(byTest.get(key) ?? [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const inRange = rows.filter((r) => new Date(r.date).getTime() >= t0);
    if (!inRange.length) return null;
    const before = rows.filter((r) => new Date(r.date).getTime() < t0);
    const prev = before.length ? [toRow(before[before.length - 1], true)] : [];
    return { test: key, label: LAB_TEST_LABEL[key] ?? key.toUpperCase(), rows: [...prev, ...inRange.map((r) => toRow(r, false))] };
  };
  const listed = new Set(LAB_GROUPS.flatMap((g) => g.tests));
  const groups: LabTableGroup[] = [];
  for (const g of LAB_GROUPS) {
    const tests = g.tests.map(build).filter((t): t is LabTableTest => t != null);
    if (tests.length) groups.push({ heading: g.heading, tests });
  }
  const other = [...byTest.keys()].filter((k) => !listed.has(k)).sort().map(build).filter((t): t is LabTableTest => t != null);
  if (other.length) groups.push({ heading: 'Other', tests: other });
  return groups;
}
