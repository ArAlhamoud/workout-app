import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import { getHealthData } from '../../health-actions';
import {
  afCorrelates,
  afStats,
  dayRelativeSymptoms,
  severityByDose,
  weightSnapshot,
  SYMPTOM_LABEL as KIND_LABEL,
} from '@/lib/health-insights';

export const metadata: Metadata = { title: 'Health Patterns' };
export const dynamic = 'force-dynamic';

/** 0-3 severity → cell background. */
const heat = (v: number) =>
  v >= 2.5 ? 'bg-rpe-hard/70' : v >= 1.5 ? 'bg-rpe-med/70' : v >= 0.5 ? 'bg-acc-cyan/40' : 'bg-ink/5';

export default async function HealthAnalyticsPage() {
  const data = await getHealthData();
  const injections = data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site }));
  const symptoms = data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity }));

  const relative = dayRelativeSymptoms(symptoms, injections);
  const byDose = severityByDose(symptoms, injections);
  const af = afStats(data.afEpisodes);
  const correlates = afCorrelates(data.afEpisodes);
  const weight = weightSnapshot(
    data.profile,
    (data.profile.milestonesKg as number[] | null) ?? [],
    data.bodyStats,
  );

  // Weight vs AHI: monthly averages of both, shown side by side when at
  // least 2 months of CPAP data exist alongside weigh-ins.
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const ahiByMonth = new Map<string, { total: number; n: number }>();
  for (const n of data.cpapNights) {
    if (n.ahi == null) continue;
    const k = monthKey(new Date(n.night));
    const cur = ahiByMonth.get(k) ?? { total: 0, n: 0 };
    cur.total += n.ahi; cur.n += 1;
    ahiByMonth.set(k, cur);
  }
  const weightByMonth = new Map<string, { total: number; n: number }>();
  for (const b of data.bodyStats) {
    if (b.weight == null) continue;
    const k = monthKey(new Date(b.date));
    const cur = weightByMonth.get(k) ?? { total: 0, n: 0 };
    cur.total += b.weight; cur.n += 1;
    weightByMonth.set(k, cur);
  }
  const cpapMonths = [...ahiByMonth.keys()]
    .filter((k) => weightByMonth.has(k))
    .sort()
    .slice(-6)
    .map((k) => ({
      month: k,
      ahi: Math.round((ahiByMonth.get(k)!.total / ahiByMonth.get(k)!.n) * 10) / 10,
      weight: Math.round((weightByMonth.get(k)!.total / weightByMonth.get(k)!.n) * 10) / 10,
    }));

  const relativeKinds = Object.entries(relative).filter(([, cells]) =>
    cells.some((c) => c.count >= 2),
  );

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Health" />
      <div>
        <p className="section-label text-acc-cyan/80">Observed patterns · your logs only</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Patterns
        </h1>
      </div>

      {/* Side effects relative to injection day */}
      <div className="card-lg p-4">
        <p className="section-label mb-1">Days after injection</p>
        {relativeKinds.length === 0 ? (
          <p className="text-sm text-app-tx3">
            Not enough data yet — this fills in after a few weeks of symptom logs around
            injections. Each row will show how a symptom moves from day 0 to day 7.
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex items-center gap-2 pl-24 pr-1">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="flex-1 text-center text-[9px] font-bold text-app-tx3">
                  {i === 0 ? 'D0' : `+${i}`}
                </span>
              ))}
            </div>
            <div className="space-y-1.5">
              {relativeKinds.map(([kind, cells]) => {
                const byOffset = new Map(cells.map((c) => [c.offset, c]));
                return (
                  <div key={kind} className="flex items-center gap-2">
                    <span className="w-22 min-w-[5.5rem] text-xs font-semibold text-app-tx2">
                      {KIND_LABEL[kind] ?? kind}
                    </span>
                    <div className="flex flex-1 gap-1">
                      {Array.from({ length: 8 }, (_, offset) => {
                        const cell = byOffset.get(offset);
                        return (
                          // Value in the cell, not a title tooltip — there
                          // is no hover on a phone (device-tester).
                          <div
                            key={offset}
                            className={`flex h-6 flex-1 items-center justify-center rounded text-[8px] font-bold text-app-tx1/80 ${heat(cell?.avgSeverity ?? 0)}`}
                          >
                            {cell ? cell.avgSeverity : ''}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-app-tx3">
              Cell = average logged severity on that day after an injection.
            </p>
          </>
        )}
      </div>

      {/* Severity by dose */}
      <div className="card-lg p-4">
        <p className="section-label mb-1">By dose level</p>
        {Object.keys(byDose).length === 0 ? (
          <p className="text-sm text-app-tx3">
            Appears once a symptom has 3+ logs at a dose level — the question it answers:
            did anything change after a dose escalation?
          </p>
        ) : (
          <div className="space-y-2">
            {Object.entries(byDose).map(([kind, rows]) => (
              <div key={kind} className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-app-tx1">{KIND_LABEL[kind] ?? kind}</span>
                <span className="text-xs tabular-nums text-app-tx2">
                  {rows.map((r) => `${r.doseMg} mg: avg ${r.avgSeverity} (${r.n})`).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AF */}
      <div className="card-lg p-4">
        <p className="section-label mb-1">AF episodes</p>
        <div className="flex items-baseline gap-4">
          <div>
            <div className="metric-value text-app-tx1">{af.thisMonth}</div>
            <div className="metric-label">this month</div>
          </div>
          <div>
            <div className="metric-value text-app-tx2">{af.lastMonth}</div>
            <div className="metric-label">last month</div>
          </div>
          {af.perMonth.length >= 2 && (
            <div className="ml-auto flex items-end gap-1">
              {af.perMonth.slice(-6).map((m) => (
                <div key={m.month} className="flex flex-col items-center gap-0.5">
                  <div
                    className="w-4 rounded-t bg-rpe-hard/60"
                    style={{ height: `${Math.min(40, 6 + m.count * 8)}px` }}
                  />
                  <span className="text-[8px] font-bold text-app-tx3">{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 border-t border-ink/10 pt-3">
          {correlates === null ? (
            <p className="text-sm text-app-tx3">
              Circumstance patterns appear after 5+ episodes have their flags answered
              (the bloating/gas/meal buttons when logging). Until then, any percentage
              would be noise.
            </p>
          ) : (
            <div className="space-y-1.5">
              {correlates.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-sm">
                  <span className="w-32 flex-none text-xs text-app-tx2">{c.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className="h-full rounded-full bg-rpe-hard/70"
                      style={{ width: `${Math.round((c.hits / c.answered) * 100)}%` }}
                    />
                  </div>
                  <span className="w-14 flex-none text-right text-xs tabular-nums text-app-tx1">
                    {c.hits} of {c.answered}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-[10px] text-app-tx3">
                Association in your logs, not causation — a thing to discuss with your doctor,
                not a conclusion.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Weight vs AHI */}
      <div className="card-lg p-4">
        <p className="section-label mb-1">Weight × sleep apnea</p>
        {cpapMonths.length < 2 ? (
          <p className="text-sm text-app-tx3">
            Appears after two months of CPAP nights alongside weigh-ins — the long-game
            question: does AHI fall as weight falls?
          </p>
        ) : (
          <div className="space-y-1.5">
            {cpapMonths.map((m) => (
              <div key={m.month} className="flex items-baseline justify-between text-sm">
                <span className="text-xs text-app-tx3">{m.month}</span>
                <span className="tabular-nums text-app-tx1">{m.weight} kg</span>
                <span className="tabular-nums text-app-tx2">AHI {m.ahi}</span>
              </div>
            ))}
          </div>
        )}
        {weight && (
          <p className="mt-2 border-t border-ink/10 pt-2 text-[11px] text-app-tx3">
            Total so far: {weight.lostKg > 0 ? `−${weight.lostKg}` : weight.lostKg} kg
            ({weight.pctLost}%).
          </p>
        )}
      </div>
    </div>
  );
}
