# AR Health — the Mounjaro module

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
- BP auto-import: the home monitor syncs to Apple Health; HealthAutoPilot
  reads both halves (`bloodPressureSystolic/Diastolic`, 30-day rolling
  window) and `/api/health/import` pairs them (`pairBpSamples`, ±60 s),
  drops implausible pairs with the manual logger's bounds, and skips any
  minute that already holds a reading — manual entries always win.
  Imported rows carry `notes: 'Apple Health'`. Requires the bridge
  deployed with the BP types (Mac: `npm run ios:deploy`, then re-grant
  Health access; reinstall if iOS shows no new permission sheet).

## The one static safety line

Two or more severity-3 logs of vomiting / abdominal pain / dizziness
within 48 h show a fixed "worth getting checked" card on the hub. The
app never judges urgency — it only refuses to stay silent. Do not add
more triggers without the clinical-safety review lens; alarm fatigue is
the failure mode on the other side.

## Fuel (daily macros — Aug 27, the calorie kill-list reversed)

The owner joined a macro-printed meal subscription, which made the four
numbers free to copy — he asked for the tracker (“i plan to have tracker
for daily micros”). /health/fuel: one day-total entry (kcal/P/C/F,
PATCH-upserted onto NutritionLog’s new nullable columns), targets in
profile.targets (kcal/fuelProteinG/carbsG/fatG; suggested defaults
2200/130/230/85 derived transparently in health-insights.ts —
FUEL_DEFAULTS), a 3-day-guarded week summary, and counts-not-grades
copy: a light day on a GLP-1 is the medicine working. Protein is framed
as the number to defend.

## Deliberately not built

ECG interpretation (validated-integration
territory), AFib auto-import (still needs its own read type when that
day comes), medication adjustment suggestions of any kind. BP import is
now BUILT (see above — Aug 2026). CPAP auto-import is IMPOSSIBLE, not
skipped: the Löwenstein prisma APP exports nothing to Apple Health (its
data goes only to prisma CLOUD for clinicians); mask hours + AHI stay a
manual answer in the check-in, anchored by the Watch's sleep count shown
beside the input (reference only — never pre-filled, mask time ≠ sleep
time).
