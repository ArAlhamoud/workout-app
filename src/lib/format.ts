// Shared formatting & date helpers used across server pages and components.

/** "45m" / "1h 12m" from a duration in seconds. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "Today" / "Yesterday" / "3d ago" / "May 10" relative to now. */
export function formatRelative(date: Date): string {
  const diffDays = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(date));
}

/** "May 10, 2026" */
export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(date));
}

/** "Sunday, May 10, 2026" */
export function formatDateLong(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

/** Estimated 1RM via the Epley formula, rounded to the nearest kg. */
export function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

/** Index by RPE value 1–4 (index 0 unused). */
export const RPE_LABELS = ['', 'Easy', 'Med', 'Hard', 'Grind'] as const;

/** Effort-spectrum text classes by RPE value 1–4 (index 0 unused). */
export const RPE_COLORS = ['', 'text-rpe-easy', 'text-rpe-med', 'text-rpe-hard', 'text-rpe-grind'] as const;

/** Category badge classes (text + bg + border), tuned to the aurora hues.
 *  Amber is reserved for the Return Protocol and gold for PRs — never used here. */
export const CATEGORY_BADGE: Record<string, string> = {
  CHEST:     'text-acc-violet bg-acc-violet-deep/15 border-acc-violet/30',
  BACK:      'text-acc-teal bg-acc-teal-deep/15 border-acc-teal/30',
  LEGS:      'text-acc-cyan bg-acc-cyan/10 border-acc-cyan/30',
  SHOULDERS: 'text-indigo-300 bg-acc-indigo/15 border-indigo-400/30',
  ARMS:      'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
  CORE:      'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-400/30',
};

/** Compact kg volume: "1.2k" at ≥1000, otherwise "850". */
export function kgCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
}

/** Today's date as YYYY-MM-DD built from LOCAL date parts (no UTC drift). */
export function localTodayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Midnight (local) on the Monday of the week containing `date`. */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * ISO-8601 year-week key, e.g. "2026-W01". Weeks start Monday and the
 * ISO week-year is used, so keys stay correct across year boundaries
 * (Dec 29 2025 → "2026-W01", Jan 1 2027 → "2026-W53").
 */
export function weekKey(date: Date): string {
  const src = new Date(date);
  const d = new Date(Date.UTC(src.getFullYear(), src.getMonth(), src.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
