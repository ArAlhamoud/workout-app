import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import { getHealthData } from '../../health-actions';
import { DEFAULT_DOSE_PLAN, type DosePlanStep } from '@/lib/health-insights';
import PlanEditor from '@/components/health/PlanEditor';

export const metadata: Metadata = { title: 'Plan & Profile' };
export const dynamic = 'force-dynamic';

export default async function HealthPlanPage() {
  const data = await getHealthData();
  const { profile } = data;

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Health" />
      <div>
        <p className="section-label text-acc-cyan/80">Everything here is yours to change</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Plan &amp; Profile
        </h1>
      </div>

      <PlanEditor
        profile={{
          heightCm: profile.heightCm,
          startWeightKg: profile.startWeightKg,
          goalWeightKg: profile.goalWeightKg,
          milestonesKg: (profile.milestonesKg as number[] | null) ?? [],
          dosePlan: ((profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN),
          reminders: (profile.reminders as Record<string, boolean> | null) ?? {},
        }}
        injections={data.injections.slice(0, 10).map((i) => ({
          id: i.id,
          at: i.at.toISOString(),
          doseMg: i.doseMg,
          site: i.site,
        }))}
        labs={data.labs.slice(0, 20).map((l) => ({
          id: l.id,
          date: l.date.toISOString(),
          test: l.test,
          value: l.value,
          unit: l.unit,
        }))}
      />
    </div>
  );
}
