import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import { getHealthData } from '../../health-actions';
import { deliveryDayPattern, fuelTargets, fuelWeek, learnedMaintenance, ownerDayKey } from '@/lib/health-insights';
import FuelTracker from '@/components/health/FuelTracker';

export const metadata: Metadata = { title: 'Fuel' };
export const dynamic = 'force-dynamic';

// The fuel room: today against the targets (his meal app's own mental
// model — eaten, and what's left), a 10-second daily entry, the guarded
// week, and the recent days. The app counts; it never grades a day.
export default async function FuelPage() {
  const data = await getHealthData();
  const targets = fuelTargets(
    (data.profile.targets as Record<string, unknown> | null) ?? null,
  );

  // NutritionLog days are stored at UTC midnight of the owner's local day.
  const todayIso = ownerDayKey();
  const today =
    data.nutrition.find((n) => n.day.toISOString().slice(0, 10) === todayIso) ?? null;

  const week = fuelWeek(
    data.nutrition.map((n) => ({
      day: n.day, kcal: n.kcal, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG,
    })),
    targets,
  );

  const learned = learnedMaintenance(
    data.nutrition.map((n) => ({ day: n.day, kcal: n.kcal })),
    data.bodyStats,
  );
  const delivery = deliveryDayPattern(data.nutrition.map((n) => ({ day: n.day, kcal: n.kcal })));

  const recent = data.nutrition
    .filter((n) => n.kcal != null || n.proteinG != null || n.carbsG != null || n.fatG != null)
    .slice(0, 14);

  const cell = (
    label: string,
    value: number | null | undefined,
    target: number,
    unit: string,
  ) => {
    const left = value != null ? target - value : null;
    return (
      <div className="card p-3" key={label}>
        <p className="metric-value">{value != null ? value : '—'}</p>
        <p className="metric-label">
          {label}
          {value == null
            ? ` · target ${target}${unit}`
            : left != null && left >= 0
              ? ` · ${left}${unit} left`
              : ` · ${Math.abs(left!)}${unit} over`}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Home" />
      <div>
        <p className="section-label text-acc-cyan/80">Daily macros</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Fuel
        </h1>
      </div>

      {/* Today, in his meal app's own language */}
      <div className="grid grid-cols-2 gap-2">
        {cell('kcal', today?.kcal, targets.kcal, '')}
        {cell('Protein', today?.proteinG, targets.proteinG, 'g')}
        {cell('Carbs', today?.carbsG, targets.carbsG, 'g')}
        {cell('Fat', today?.fatG, targets.fatG, 'g')}
      </div>

      <FuelTracker targets={targets} />

      {/* The week, guarded */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Last 7 days</p>
        {week.daysLogged === 0 ? (
          <p className="text-sm text-app-tx2">Nothing logged yet.</p>
        ) : (
          <div className="space-y-1.5 text-sm text-app-tx1">
            <p>
              <span className="font-extrabold tabular-nums">{week.daysLogged}</span> of 7 days logged
            </p>
            <p>
              {week.avgKcal !== null
                ? <>Average <span className="font-extrabold tabular-nums">{week.avgKcal}</span> kcal</>
                : 'Calorie average needs 3+ logged days'}
            </p>
            <p>
              {week.proteinLoggedDays > 0
                ? <>Protein target hit <span className="font-extrabold tabular-nums">{week.proteinHitDays}</span> of {week.proteinLoggedDays} logged day{week.proteinLoggedDays === 1 ? '' : 's'}</>
                : 'No protein logged this week'}
            </p>
          </div>
        )}
      </div>

      {/* What your own ledger says maintenance really is */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Your real maintenance</p>
        {learned ? (
          <div className="space-y-0.5 text-sm text-app-tx1">
            <p>
              {learned.days} days · avg <span className="font-extrabold tabular-nums">{learned.avgIntakeKcal}</span> kcal
              · scale <span className="font-extrabold tabular-nums">{learned.deltaKg > 0 ? '+' : learned.deltaKg < 0 ? '−' : ''}{Math.abs(learned.deltaKg)} kg</span>
              {' → '}maintenance ≈ <span className="font-extrabold tabular-nums text-acc-teal">{learned.maintenanceKcal}</span> kcal
            </p>
            <p>
              Target {targets.kcal} → <span className="font-extrabold tabular-nums">{targets.kcal - learned.maintenanceKcal > 0 ? '+' : '−'}{Math.abs(targets.kcal - learned.maintenanceKcal)}</span>/day
            </p>
            {Math.abs(learned.deltaKg) > (learned.days / 7) * 1.5 && (
              <p className="text-[11px] font-semibold text-app-tx3">
                Early fast loss includes water — this estimate settles as the weeks add up.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-app-tx2">
            Not enough data yet — needs 8+ logged days and 4+ weigh-ins across two weeks.
          </p>
        )}
      </div>

      {delivery && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">Delivery days vs your own cooking</p>
          <div className="space-y-1.5 text-sm text-app-tx1">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-app-tx2">Sun–Thu (delivered)</span>
              <span className="font-round font-extrabold tabular-nums">{delivery.deliveryAvg} kcal
                <span className="ml-1.5 text-[11px] font-semibold text-app-tx3">× {delivery.nDelivery}</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-app-tx2">Fri–Sat (yours)</span>
              <span className="font-round font-extrabold tabular-nums">{delivery.ownAvg} kcal
                <span className="ml-1.5 text-[11px] font-semibold text-app-tx3">× {delivery.nOwn}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* The recent days */}
      {recent.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">Day by day</p>
          <div className="divide-y divide-ink/5">
            {recent.map((n) => (
              <div key={n.id} className="flex min-h-[40px] items-baseline justify-between py-1.5">
                <span className="text-sm font-semibold text-app-tx2">
                  {n.day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                </span>
                <span className="font-round text-sm font-extrabold tabular-nums text-app-tx1">
                  {n.kcal != null ? `${n.kcal} kcal` : '—'}
                  <span className="ml-1.5 text-[11px] font-semibold text-app-tx3">
                    {[
                      n.proteinG != null ? `${n.proteinG}P` : null,
                      n.carbsG != null ? `${n.carbsG}C` : null,
                      n.fatG != null ? `${n.fatG}F` : null,
                    ].filter(Boolean).join(' / ') || 'no macros'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-app-tx3">
        Counts, not grades — a light day on Mounjaro is the medicine working.
      </p>
    </div>
  );
}
