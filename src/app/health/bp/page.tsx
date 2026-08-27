import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import { getHealthData } from '../../health-actions';
import { BP_CONTEXT_LABEL, bpAverage, bpContextAverages, bpWeeklyAverages, bpWeightStory } from '@/lib/health-insights';
import BpTracker from '@/components/health/BpTracker';

export const metadata: Metadata = { title: 'Pressure' };
export const dynamic = 'force-dynamic';

// The pressure room: latest reading, guarded averages, the weekly drift,
// and every reading with its moment. Numbers only — what a reading MEANS
// is between the owner, Nebilet, and his doctor (tracker law #1).
export default async function BpPage() {
  const data = await getHealthData();
  const readings = data.bpReadings.map((r) => ({
    at: r.at,
    systolic: r.systolic,
    diastolic: r.diastolic,
    context: r.context,
  }));

  const latest = data.bpReadings[0] ?? null;
  const avg7 = bpAverage(readings, 7);
  const avg30 = bpAverage(readings, 30);
  const byContext = bpContextAverages(readings, 30);
  const weekly = bpWeeklyAverages(readings, 8);
  const story = bpWeightStory(readings, data.bodyStats);

  const weekLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Home" />
      <div>
        <p className="section-label text-acc-cyan/80">Blood pressure</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Pressure
        </h1>
      </div>

      {/* Now + the guarded averages */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3">
          <p className="metric-value">{latest ? `${latest.systolic}/${latest.diastolic}` : '—'}</p>
          <p className="metric-label">
            {latest
              ? `latest · ${new Date(latest.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : 'no readings yet'}
          </p>
        </div>
        <div className="card p-3">
          <p className="metric-value">{avg7 ? `${avg7.systolic}/${avg7.diastolic}` : '—'}</p>
          <p className="metric-label">{avg7 ? `7-day · ${avg7.n} readings` : '7-day · needs 3+'}</p>
        </div>
        <div className="card p-3">
          <p className="metric-value">{avg30 ? `${avg30.systolic}/${avg30.diastolic}` : '—'}</p>
          <p className="metric-label">{avg30 ? `30-day · ${avg30.n} readings` : '30-day · needs 3+'}</p>
        </div>
      </div>

      {/* The moments compared, when the data can carry it */}
      {byContext.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">By moment · last 30 days</p>
          <div className="space-y-1.5">
            {byContext.map((c) => (
              <div key={c.context} className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-app-tx1">
                  {BP_CONTEXT_LABEL[c.context] ?? c.context}
                </span>
                <span className="font-round text-base font-extrabold tabular-nums text-app-tx1">
                  {c.systolic}/{c.diastolic}
                  <span className="ml-1.5 text-[11px] font-semibold text-app-tx3">× {c.n}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The weekly drift */}
      {weekly.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">Week by week</p>
          <div className="space-y-1.5">
            {weekly.map((w) => (
              <div key={w.weekStart.toISOString()} className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-app-tx2">{weekLabel(w.weekStart)}</span>
                {w.systolic !== null ? (
                  <span className="font-round text-base font-extrabold tabular-nums text-app-tx1">
                    {w.systolic}/{w.diastolic}
                    <span className="ml-1.5 text-[11px] font-semibold text-app-tx3">× {w.n}</span>
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-app-tx3">
                    {w.n} reading{w.n === 1 ? '' : 's'} — not enough
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {story && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">Pressure as the weight moves</p>
          <div className="space-y-1.5">
            {story.map((m) => (
              <div key={m.month} className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-app-tx2">
                  {new Date(`${m.month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                </span>
                <span className="font-round text-base font-extrabold tabular-nums text-app-tx1">
                  {m.systolic}/{m.diastolic}
                  <span className="ml-2 text-[11px] font-semibold text-app-tx3">at {m.kg} kg</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-app-tx3">
            Observed together in your logs — the association your cardiologist will want to see.
          </p>
        </div>
      )}

      <BpTracker
        readings={data.bpReadings.slice(0, 60).map((r) => ({
          id: r.id,
          at: r.at.toISOString(),
          systolic: r.systolic,
          diastolic: r.diastolic,
          pulse: r.pulse,
          context: r.context,
          imported: r.notes === 'Apple Health',
        }))}
      />

      <p className="text-[10px] leading-relaxed text-app-tx3">
        Readings from your monitor arrive on their own once the Health link is granted —
        logged and imported readings never duplicate. What a number means is a conversation
        for you and your doctor.
      </p>
    </div>
  );
}
