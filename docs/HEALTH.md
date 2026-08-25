# Aurora Health — the Mounjaro module

The app's second domain: a personal health tracker where the Mounjaro
(tirzepatide) treatment timeline is the spine and weight, GI symptoms,
AF episodes, CPAP, blood pressure and labs are correlated around it.

## Laws (hold every change to these)

1. **Tracker, not diagnostic.** Correlation language only ("your logs
   show an association"), never causation, never diagnosis, never dosing
   advice. Decisions belong to the owner and his doctor.
2. **The clock anchors at the first LOGGED injection.** Week 1 · day 0 is
   an event, never an assumed date. Checkpoint weeks in the dose plan
   prescribe nothing — nothing auto-escalates past the doctor review.
3. **Guards over charts.** Below honest thresholds (4 weigh-ins for a
   projection, 5 answered episodes for an AF correlate, 3 readings for a
   BP average, 3 logs for a dose comparison) the answer is "not enough
   data yet" — a chart from 3 points is a lie with axes.
4. **Ten-second logging.** Segmented controls, tri-state flags
   (yes/no/skip — an unanswered flag never enters a denominator),
   last-value defaults, one row per CPAP night (upsert).
5. **Deterministic and $0.** Every insight is transparent arithmetic in
   `src/lib/health-insights.ts`, tested in `scripts/coach-tests.ts`.
6. **Days are calendar days** — an evening dose on the 8th is 2 days back
   on the morning of the 10th (the dynamic-plan lesson, inherited).

## Map

- `src/lib/health-insights.ts` — the pure brain (clock, rotation,
  snapshot, projections, day-relative symptoms, dose comparison, AF
  stats/correlates, CPAP/BP aggregates, severe-symptom notice gate).
- `src/app/health-actions.ts` — server actions: seeding (profile 169 cm /
  133 kg / goal 103, dose plan 2.5×4 → 5×2 → doctor review, Nebilet +
  Mounjaro, baseline LDL 4.54), bounded writes for every entity.
- `/health` hub · `/health/injection` (rotation assistant + after-dose
  pass) · `/health/timeline` · `/health/analytics` · `/health/report`
  (printable, English + Arabic RTL, `/api/health/export` CSV).
- Reminders: local notification ids **3001** (injection day 18:00),
  **3002** (missed, next day 10:00), **3003** (day-1 symptom check
  20:00) — armed on /health visits, Gap Guard pattern.
- Backup: all nine tables ride `scripts/export-data.js` /
  `restore-from-snapshot.js` under the `health` key, and the sectioned
  CSV at `/api/health/export`.

## The one static safety line

Two or more severity-3 logs of vomiting / abdominal pain / dizziness
within 48 h show a fixed "worth getting checked" card on the hub. The
app never judges urgency — it only refuses to stay silent. Do not add
more triggers without the clinical-safety review lens; alarm fatigue is
the failure mode on the other side.

## Deliberately not built

Calorie counting (kill-list), ECG interpretation (validated-integration
territory), automatic HealthKit BP/AFib import (needs new read types →
reinstall + Mac trip — columns are ready when that day comes), medication
adjustment suggestions of any kind.
