import Link from 'next/link';
import type { Metadata } from 'next';
import { getHealthData } from './health-actions';
import { getWorkouts } from './actions';
import { getDynamicPlan, getTrainingStatus, isTrainingSession, queuedDay } from '@/lib/program';
import TrainingCard from '@/components/health/TrainingCard';
import HealthReminders from '@/components/health/HealthReminders';
import {
  afStats,
  bpAverage,
  cpapStats,
  severeSymptomFlag,
  siteLabel,
  nextSite,
  treatmentClock,
  weightSnapshot,
  weightProjections,
  DEFAULT_DOSE_PLAN,
  DEFAULT_ROTATION,
  SYMPTOM_LABEL,
  type DosePlanStep,
} from '@/lib/health-insights';
import QuickLog from '@/components/health/QuickLog';

export const metadata: Metadata = { title: 'Aurora Health' };
export const dynamic = 'force-dynamic';

const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// The health-first Home: the app IS the health tracker, and training is
// one room in it (the owner's re-orientation, Aug 25). The old training
// home lives on at /train.
export default async function HomePage() {
  const [data, workouts] = await Promise.all([getHealthData(), getWorkouts()]);
  const trainPlan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })));
  const trainStatus = getTrainingStatus(workouts.filter(isTrainingSession).map((w) => w.date));
  const { profile } = data;
  const plan = ((profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN);
  const rotation =
    ((profile.targets as { rotation?: string[] } | null)?.rotation ?? DEFAULT_ROTATION);

  const clock = treatmentClock(
    data.injections, plan, new Date(),
    data.firstInjectionAt ?? undefined, data.injectionCount,
  );
  const site = nextSite(rotation, data.injections);
  const weight = weightSnapshot(
    profile,
    ((profile.milestonesKg as number[] | null) ?? [120, 110, 103]),
    data.bodyStats,
  );
  const projections = weight
    ? weightProjections(data.bodyStats, ((profile.milestonesKg as number[] | null) ?? [120, 110, 103]))
    : null;
  const af = afStats(data.afEpisodes);
  const cpap = cpapStats(data.cpapNights);
  const bp7 = bpAverage(data.bpReadings, 7);
  const latestBp = data.bpReadings[0] ?? null;
  const latestLdl = data.labs.find((l) => l.test === 'ldl') ?? null;
  // "Today" is the local calendar day, not a rolling 24 hours — a symptom
  // from yesterday evening is not "today" this afternoon.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySymptoms = data.symptoms.filter((s) => new Date(s.at) >= todayStart);
  const severe = severeSymptomFlag(
    data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity })),
  );

  return (
    <div className="space-y-5 pb-8">
      {/* Home owns the reminder arming too — /health/* pages arm via their
          layout, and the most-visited screen must not be the one that
          forgets (device-tester lesson from the hub-only mount). */}
      <HealthReminders
        nextDueISO={clock ? clock.nextDue.toISOString() : null}
        lastInjectionISO={clock ? clock.lastInjection.toISOString() : null}
        enabled={(profile.reminders as Record<string, boolean> | null) ?? {}}
      />
      <div className="pt-1">
        <p className="section-label text-acc-cyan/80">Aurora Health</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Today
        </h1>
      </div>

      {/* Static safety line — shown only on repeated severe red-flag logs.
          The app never judges urgency; it only refuses to stay silent. */}
      {severe && (
        <div className="card border-rpe-hard/40 px-4 py-3">
          <p className="text-sm text-app-tx1">
            You&apos;ve logged repeated severe symptoms in the last two days. This app can&apos;t
            judge how serious that is — a clinician can. Consider getting checked.
          </p>
        </div>
      )}

      {/* Hero */}
      <div className="card-lg p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-round text-3xl font-light tabular-nums glow-cyan">
              {weight ? `${weight.currentKg} kg` : '— kg'}
            </div>
            <p className="metric-label mt-0.5">
              {weight ? `${weight.lostKg >= 0 ? '−' : '+'}${Math.abs(weight.lostKg)} kg · ${weight.pctLost}% · BMI ${weight.bmi}` : 'no weigh-in yet'}
            </p>
          </div>
          <div className="text-right">
            <div className="font-round text-xl font-semibold tabular-nums text-app-tx1">
              {clock ? `${clock.lastDoseMg} mg` : '2.5 mg'}
            </div>
            <p className="metric-label mt-0.5">
              {clock ? `week ${clock.week}` : 'week 1 · not started'}
            </p>
          </div>
        </div>
        <div className="mt-3 border-t border-ink/10 pt-3">
          {clock ? (
            <p className="text-sm text-app-tx2">
              Next injection <b className="text-app-tx1">{fmtDay(clock.nextDue)}</b>
              {clock.nextPlanned?.mg != null ? (
                <> · <b className="text-app-tx1">{clock.nextPlanned.mg} mg</b></>
              ) : clock.nextPlanned ? (
                <> · <b className="text-acc-ember">{clock.nextPlanned.label ?? 'Doctor review'} — no dose scheduled</b></>
              ) : (
                <> · <b className="text-acc-ember">plan ends here — extend it in Plan</b></>
              )}
              {' '}· {siteLabel(site)}
            </p>
          ) : (
            <p className="text-sm text-app-tx2">
              Log your first injection to start the treatment clock — week 1 begins there.
            </p>
          )}
        </div>
        <Link
          href="/health/injection"
          className="mt-3 flex w-full items-center justify-center rounded-card-lg bg-gradient-to-r from-acc-cyan to-acc-teal py-3 text-sm font-bold text-white shadow-glow-teal transition-all active:scale-[0.99]"
        >
          {clock ? 'Injection day →' : 'Log first injection →'}
        </Link>
      </div>

      {/* Quick logs — the <10 second promise lives here */}
      <QuickLog />

      {/* Training — one room in the house now */}
      <TrainingCard
        plan={trainPlan}
        nextDay={queuedDay(trainPlan)}
        returnMode={trainStatus.mode === 'return'}
      />

      {/* Weight milestones */}
      {weight && (
        <div className="card-lg p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="section-label">Weight</p>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-tx3">
              {weight.startKg} → {weight.currentKg} → {profile.goalWeightKg} kg
            </span>
          </div>
          <div className="space-y-2">
            {weight.kgMilestones.map((m) => {
              const total = weight.startKg - m.kg;
              const done = Math.min(total, Math.max(0, weight.startKg - weight.currentKg));
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const proj = projections?.find((p) => p.targetKg === m.kg);
              return (
                <div key={m.kg}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className={m.achieved ? 'text-acc-teal font-semibold' : 'text-app-tx2'}>
                      {m.kg} kg {m.achieved ? '· reached' : ''}
                    </span>
                    {!m.achieved && proj?.estimatedDate && (
                      <span className="text-app-tx3">
                        ~{proj.estimatedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className={`h-full rounded-full ${m.achieved ? 'bg-acc-teal' : 'bg-acc-cyan/70'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {projections && (
            <p className="mt-2 text-[10px] text-app-tx3">
              Dates are projections from your recent trend — not a guarantee.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {weight.pctMilestones.map((m) => (
              <span
                key={m.pct}
                className={`chip border ${m.achieved ? 'border-acc-teal/40 bg-acc-teal/10 text-acc-teal' : 'border-app-border bg-app-surface2 text-app-tx3'}`}
              >
                {m.pct}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Glance cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="card p-3.5">
          <p className="metric-label">AF</p>
          <div className="metric-value mt-1 text-app-tx1">
            {af.daysSinceLast === null ? '—' : af.daysSinceLast}
            <span className="ml-1 text-xs font-semibold text-app-tx3">
              {af.daysSinceLast === null ? 'no episodes logged' : 'days since episode'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-app-tx3">{af.thisMonth} this month</p>
        </div>
        <div className="card p-3.5">
          <p className="metric-label">CPAP</p>
          <div className="metric-value mt-1 text-app-tx1">
            {cpap.avgHours30d ?? '—'}
            <span className="ml-1 text-xs font-semibold text-app-tx3">h/night · 30d</span>
          </div>
          <p className="mt-1 text-[11px] text-app-tx3">
            {cpap.avgAhi30d != null ? `AHI ${cpap.avgAhi30d} · ` : ''}
            {cpap.streak > 1 ? `${cpap.streak}-night streak` : `${cpap.nights30d} nights logged`}
          </p>
        </div>
        <div className="card p-3.5">
          <p className="metric-label">Blood pressure</p>
          <div className="metric-value mt-1 text-app-tx1">
            {latestBp ? `${latestBp.systolic}/${latestBp.diastolic}` : '—'}
          </div>
          <p className="mt-1 text-[11px] text-app-tx3">
            {bp7 ? `7-day avg ${bp7.systolic}/${bp7.diastolic} (${bp7.n})` : 'log 3+ readings for an average'}
          </p>
        </div>
        <div className="card p-3.5">
          <p className="metric-label">Labs</p>
          <div className="metric-value mt-1 text-app-tx1">
            {latestLdl ? latestLdl.value : '—'}
            <span className="ml-1 text-xs font-semibold text-app-tx3">LDL mmol/L</span>
          </div>
          <p className="mt-1 text-[11px] text-app-tx3">
            {latestLdl ? new Date(latestLdl.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'no labs yet'}
          </p>
        </div>
        <div className="card p-3.5">
          <p className="metric-label">GI today</p>
          <div className="metric-value mt-1 text-app-tx1">
            {todaySymptoms.length ? todaySymptoms.length : '—'}
            <span className="ml-1 text-xs font-semibold text-app-tx3">
              {todaySymptoms.length === 1 ? 'symptom logged' : 'symptoms logged'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-app-tx3">
            {todaySymptoms.length
              ? todaySymptoms.slice(0, 2).map((s) => SYMPTOM_LABEL[s.kind] ?? s.kind).join(' · ')
              : 'nothing logged today'}
          </p>
        </div>
        <div className="card p-3.5">
          <p className="metric-label">Medications</p>
          <div className="metric-value mt-1 text-app-tx1">{data.meds.filter((m) => !m.stoppedOn).length}</div>
          <p className="mt-1 text-[11px] text-app-tx3">
            {data.meds.filter((m) => !m.stoppedOn).map((m) => m.name.split(' ')[0]).join(' · ') || 'none'}
          </p>
        </div>
      </div>

      {/* Section links */}
      <div className="space-y-2">
        {[
          { href: '/health/timeline', label: 'Timeline', sub: 'everything on one axis' },
          { href: '/health/analytics', label: 'Patterns', sub: 'side effects · AF · CPAP vs weight' },
          { href: '/health/report', label: 'Doctor report', sub: 'printable · English + العربية' },
          { href: '/health/plan', label: 'Plan & profile', sub: 'dose plan · labs · reminders · edits' },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="card flex items-center justify-between px-4 py-3 transition-colors hover:border-app-border-hi"
          >
            <div>
              <p className="text-sm font-semibold text-app-tx1">{l.label}</p>
              <p className="text-[11px] text-app-tx3">{l.sub}</p>
            </div>
            <span className="text-app-tx3">→</span>
          </Link>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-app-tx3">
        This is a tracker, not a diagnostic tool. Patterns shown are observations from your own
        logs — decisions about doses and medications belong to you and your doctor.
      </p>
    </div>
  );
}
