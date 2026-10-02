import { layoutChart, type ChartSpec } from '@/lib/report-charts';

/**
 * One trend chart on the doctor report, drawn from the shared geometry in
 * src/lib/report-charts.ts (the PDF draws the same shapes). Server-rendered
 * inline SVG: no client JS, prints as vectors.
 */

const W = 320;
const H = 112;

// Series colour by key. Ember stays reserved for the return-protocol ramp.
const TONE: Record<string, string> = {
  weight: 'text-acc-teal',
  systolic: 'text-acc-violet',
  diastolic: 'text-acc-cyan',
  hours: 'text-acc-teal',
  ahi: 'text-acc-violet',
  dose: 'text-acc-teal',
  // Patterns (src/lib/patterns.ts)
  kcal: 'text-acc-teal',
  kg: 'text-acc-violet',
  pressure: 'text-acc-cyan',
};

const fmtV = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export default function ReportChart({ spec }: { spec: ChartSpec }) {
  const c = layoutChart(spec, W, H);
  const multi = c.series.length > 1;
  // Labels the spec places itself (day 0…6, weeks, months) sit centred under
  // their bar or point; the report's own date ticks keep to the edges.
  const centred = !!spec.xLabels;
  return (
    <figure className="mt-2 break-inside-avoid">
      <figcaption className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px] text-app-tx3 print:text-gray-600">
        <span className="font-semibold">
          {spec.title} · {spec.unit}
        </span>
        {multi && (
          <span className="flex gap-2">
            {c.series.map((s) => (
              <span key={s.key} className={`${TONE[s.key] ?? 'text-app-tx2'} font-semibold`}>
                ― {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${spec.title} trend`}
      >
        {/* grid + y ticks */}
        <g className="text-app-tx3 print:text-gray-500">
          {c.yTicks.map((t) => (
            <g key={`y${t.label}`}>
              <line x1={c.plot.left} x2={c.plot.right} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.18} strokeWidth={0.6} />
              <text x={c.plot.left - 4} y={t.y + 3} textAnchor="end" fontSize={8} fill="currentColor">
                {t.label}
              </text>
            </g>
          ))}
          {c.xTicks.map((t, i) => (
            <text
              key={`x${i}`}
              x={t.x}
              y={H - 3}
              textAnchor={centred ? 'middle' : i === 0 ? 'start' : i === c.xTicks.length - 1 ? 'end' : 'middle'}
              fontSize={8}
              fill="currentColor"
            >
              {t.label}
            </text>
          ))}
          {c.refs.map((r) => (
            <g key={`r${r.label}`}>
              <line x1={c.plot.left} x2={c.plot.right} y1={r.y} y2={r.y} stroke="currentColor" strokeDasharray="3 3" strokeWidth={0.8} />
              <text x={c.plot.right + 3} y={r.y + 3} fontSize={8} fill="currentColor">
                {r.label}
              </text>
            </g>
          ))}
        </g>
        {c.series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.key} className={TONE[s.key] ?? 'text-app-tx1'}>
              {s.kind === 'bar'
                ? s.points.map((p) => (
                    <rect
                      key={p.t}
                      x={p.x - s.barWidth / 2}
                      y={p.y}
                      width={s.barWidth}
                      height={Math.max(0, c.plot.bottom - p.y)}
                      fill="currentColor"
                      fillOpacity={0.75}
                    />
                  ))
                : (
                  <>
                    <polyline
                      points={s.path.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                    />
                    {s.points.map((p) => (
                      <circle key={p.t} cx={p.x} cy={p.y} r={1.8} fill="currentColor" />
                    ))}
                    {last && (
                      <text x={c.plot.right + 3} y={last.y + 3} fontSize={8} fontWeight={700} fill="currentColor">
                        {fmtV(last.v)}
                      </text>
                    )}
                  </>
                )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
