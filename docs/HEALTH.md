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
3. **Device estimates are labelled as such.** The prisma report's deep
   sleep is inferred from airflow, not staged like a sleep study, and it
   disagrees with the Watch. Stored as `CpapNight.deepSleepMin` and shown
   in MINUTES — the unit the prisma app itself shows, so the two never
   disagree (owner, 2026-09-07) — averaged over ≥2 reporting nights,
   behind a disclosure. It never drives advice or a target. A night the
   report omits is absent, never zero.
4. **Guards over charts.** Below honest thresholds (4 weigh-ins for a
   projection, 5 answered episodes for an AF correlate, 3 readings for a
   BP average, 3 logs for a dose comparison) the answer is "not enough
   data yet" — a chart from 3 points is a lie with axes.
5. **Ten-second logging.** Segmented controls, tri-state flags
   (yes/no/skip — an unanswered flag never enters a denominator),
   last-value defaults, one row per CPAP night (upsert).
6. **Deterministic and $0.** Every insight is transparent arithmetic in
   `src/lib/health-insights.ts`, tested in `scripts/coach-tests.ts`.
7. **Days are calendar days** — an evening dose on the 8th is 2 days back
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

## How data gets in (the streamlined contract, Aug 29)

- Weight: smart scale → Apple Health → silent import. Automatic.
- BP: home monitor → Apple Health → paired import. Automatic after the
  native re-grant.
- Workouts: Watch detect → one-tap confirm (full Watch app in flight).
- AFib: Watch flags → tap-to-prefill chips (post re-grant); backdatable
  manual logging on the heart sheet; wrong-day undo on /health/plan.
- CPAP: the weekly prisma report PDF → POST /api/health/cpap (parsed by
  the cloud session; keyed by the morning a night ends, PATCH-upserts,
  {remove:true} rows correct; `deepSleepMin` optional, refused when it
  exceeds the night's usage; `p95Pressure`/`leak` optional, from the
  app's per-night screens — the report PDF only draws them as bars).
  Pressure is the un-floored signal for the long game: AHI is already
  treated to normal (~1.6), so it cannot fall further, while the pressure
  the machine must reach can as weight comes off. The nightly check-in question is GONE —
  device truth beats a morning guess. Breath label shows 'report due'
  past the cadence; the Sunday digest nudges.
- Planned vs eaten: the meal subscription publishes next week's macros
  days ahead, and they are logged when he sends them — so rows dated in
  the FUTURE are normal. Every "so far" reader stops at `ownerTodayUtc()`
  (weekly digest, both nav glances); the pure helpers (`fuelWeek`,
  `learnedMaintenance`, `deliveryDayPattern`) already refuse future days.
  A new reader over NutritionLog must bound itself the same way.
- Provenance: /api/health/fuel takes `notes` (≤300 chars, appended on an
  `add` row). A logged day is often a delivery BASELINE plus an estimated
  standing dinner; without a note the record cannot say which numbers
  were measured. Three reviewers once reasoned from a baseline as if it
  were a whole day (panel, 2026-09-08) — the standing weekday dinner
  (200 g chicken + rice ≈ 630 kcal / 67 P) is owner-confirmed, weekends
  are eaten out and are NOT that dinner.
- Labs: POST /api/health/labs {labs:[{date, test, value, unit, refLow?,
  refHigh?, lab?, notes?}|{date, test, remove}]} — keyed by TEST + calendar
  day, so re-posting a panel corrects it while the same test on a later day
  starts a trend. They arrive as screenshots of the lab's own app, like the
  CPAP report. Store the LAB'S reference range, not a textbook one: his
  lab's LDL ceiling is 2.59 mmol/L where the app had assumed 3.4.
- Profile lists: POST /api/health/profile {conditions?, familyHistory?,
  investigations?} — string arrays, each key REPLACES its list, omitting one
  leaves it. Three separate columns on purpose: `conditions` is his own
  diagnoses, `familyHistory` is his parents' (merging them would print their
  illnesses in his problem list), and `investigations` is tests with no
  numeric result — echo, ECG, Holter — which a lab value cannot carry.
  A cardiologist reads all three on the doctor report.
- Targets: POST /api/health/targets {kcal, proteinG, carbsG, fatG,
  waterMl, fiberG, dropLegacyProtein} — the Fuel tracker's own merge as a
  pipe, so a reviewed plan lands without retyping four numbers on a
  phone. Out-of-range LEAVES UNCHANGED, never clamps. `proteinG` writes
  `fuelProteinG`, the only protein target anything reads; the check-in's
  legacy `targets.proteinG` is dead and `dropLegacyProtein` removes it
  (two protein targets in one record is how a stored 100 g contradicted a
  displayed 130 g — panel review, 2026-09-07).
- Macros: meal-app screenshot → POST /api/health/fuel (same contract).
  THE SCREEN IS A BASELINE, NOT THE DAY: the subscription delivers
  breakfast+lunch+snack only — dinner (his own) stacks on top via
  addNutrition / {add:true} rows. Future delivery days may be pre-logged
  as planned baseline; re-posting corrects.
- Daily check-in: body → heart → extras. ~5 seconds.

## The one static safety line

Two or more severity-3 logs of vomiting / abdominal pain / dizziness
within 48 h show a fixed "worth getting checked" card on the hub. The
app never judges urgency — it only refuses to stay silent. Do not add
more triggers without the clinical-safety review lens; alarm fatigue is
the failure mode on the other side.

## Diet (daily macros — Aug 27, the calorie kill-list reversed; renamed from Fuel Aug 29)

The owner joined a macro-printed meal subscription, which made the four
numbers free to copy — he asked for the tracker (“i plan to have tracker
for daily micros”). /health/diet: one day-total entry (kcal/P/C/F,
PATCH-upserted onto NutritionLog’s new nullable columns), targets in
profile.targets (kcal/fuelProteinG/carbsG/fatG; suggested defaults
2200/130/230/85 derived transparently in health-insights.ts —
FUEL_DEFAULTS), a 3-day-guarded week summary, and counts-not-grades
copy: a light day on a GLP-1 is the medicine working. Protein is framed
as the number to defend.

## Deliberately not built

ECG interpretation (validated-integration
territory), medication adjustment suggestions of any kind. AFib
auto-LOGGING stays not built by design — but the bridge now reads BOTH
Apple AF signals (Aug 2026): irregularHeartRhythmEvent (spot-check
notifications) surfaces as tap-to-prefill chips in the heart sheet, and
atrialFibrillationBurden (AFib History's weekly %) is readable for a
future burden card. The Watch proposes; the owner confirms; nothing
auto-logs an episode. BP import is
now BUILT (see above — Aug 2026). CPAP auto-import is IMPOSSIBLE, not
skipped: the Löwenstein prisma APP exports nothing to Apple Health (its
data goes only to prisma CLOUD for clinicians); mask hours + AHI stay a
manual answer in the check-in, anchored by the Watch's sleep count shown
beside the input (reference only — never pre-filled, mask time ≠ sleep
time).
