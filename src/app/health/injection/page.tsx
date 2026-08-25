import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import { getHealthData } from '../../health-actions';
import {
  bpAverage,
  nextSite,
  severeSymptomFlag,
  siteLabel,
  treatmentClock,
  DEFAULT_DOSE_PLAN,
  DEFAULT_ROTATION,
  type DosePlanStep,
} from '@/lib/health-insights';
import InjectionForm from '@/components/health/InjectionForm';

export const metadata: Metadata = { title: 'Injection Day' };
export const dynamic = 'force-dynamic';

export default async function InjectionDayPage() {
  const data = await getHealthData();
  const { profile } = data;
  const plan = ((profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN);
  const rotation =
    ((profile.targets as { rotation?: string[] } | null)?.rotation ?? DEFAULT_ROTATION);
  const clock = treatmentClock(
    data.injections, plan, new Date(),
    data.firstInjectionAt ?? undefined, data.injectionCount,
  );
  const recommendedSite = nextSite(rotation, data.injections);
  const latestWeight = [...data.bodyStats].reverse().find((b) => b.weight != null)?.weight ?? null;
  const bp = bpAverage(data.bpReadings, 7);
  // The after-dose symptom pass lives HERE — the severe notice must too
  // (clinical-safety: it rendered only on the hub he might not revisit).
  const severe = severeSymptomFlag(
    data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity })),
  );

  // Dose to prefill: what the plan says for the NEXT injection's week —
  // before the first injection, week 1's dose. A checkpoint week prefills
  // nothing and says so.
  const plannedStep = clock ? clock.nextPlanned : plan.find((s) => s.week === 1) ?? null;
  const recentSites = data.injections.slice(0, 3).map((i) => ({
    site: i.site,
    at: i.at,
    doseMg: i.doseMg,
  }));

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Health" />
      <div>
        <p className="section-label text-acc-cyan/80">
          {clock ? `Treatment week ${clock.week}` : 'First injection'}
        </p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Injection Day
        </h1>
      </div>

      {severe && (
        <div className="card border-rpe-hard/40 px-4 py-3">
          <p className="text-sm text-app-tx1">
            You&apos;ve logged repeated severe symptoms in the last two days. This app can&apos;t
            judge how serious that is — a clinician can. Consider getting checked.
          </p>
        </div>
      )}

      {/* Before-injection glance: the facts that matter at the pen */}
      <div className="card-lg p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="metric-value text-app-tx1">
              {plannedStep?.mg != null ? `${plannedStep.mg}` : clock ? '—' : '2.5'}
              <span className="ml-0.5 text-xs text-app-tx3">mg</span>
            </div>
            <div className="metric-label mt-0.5">planned dose</div>
          </div>
          <div>
            <div className="metric-value text-app-tx1">
              {clock ? clock.daysSinceLast : '—'}
              <span className="ml-0.5 text-xs text-app-tx3">days</span>
            </div>
            <div className="metric-label mt-0.5">since last</div>
          </div>
          <div>
            <div className="metric-value text-app-tx1">
              {latestWeight ?? '—'}
              <span className="ml-0.5 text-xs text-app-tx3">kg</span>
            </div>
            <div className="metric-label mt-0.5">weight</div>
          </div>
        </div>
        {plannedStep && plannedStep.mg == null && (
          <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-acc-ember">
            {plannedStep.label ?? 'Doctor review'} — no dose is scheduled. Log what you and
            your doctor decide.
          </p>
        )}
        {clock && clock.planExhausted && plannedStep === null && (
          <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-acc-ember">
            The dose plan has no slot for this injection — extend it in Plan &amp; profile.
          </p>
        )}
        {bp && (
          <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-app-tx3">
            7-day BP average {bp.systolic}/{bp.diastolic}
          </p>
        )}
      </div>

      {/* Site rotation assistant */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Site rotation</p>
        <p className="text-sm text-app-tx1">
          Next up: <b className="text-acc-cyan">{siteLabel(recommendedSite)}</b>
        </p>
        {recentSites.length > 0 && (
          <p className="mt-1 text-[11px] text-app-tx3">
            Recent:{' '}
            {recentSites
              .map(
                (r) =>
                  `${siteLabel(r.site)} (${new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
              )
              .join(' · ')}
          </p>
        )}
      </div>

      <InjectionForm
        recommendedSite={recommendedSite}
        plannedDoseMg={plannedStep?.mg ?? null}
        lastDoseMg={clock?.lastDoseMg ?? null}
        isFirst={!clock}
      />
    </div>
  );
}
