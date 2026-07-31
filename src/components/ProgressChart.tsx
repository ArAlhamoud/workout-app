interface DataPoint {
  date: Date;
  maxWeight: number;
  reps: number;
  sessionName: string;
}

export default function ProgressChart({ data }: { data: DataPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-app-tx3 text-sm">
        Log 2+ sessions to see your chart
      </div>
    );
  }

  const W = 320;
  const H = 100;
  const pad = { top: 8, right: 8, bottom: 20, left: 32 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const weights = data.map((d) => d.maxWeight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;

  const cx = (i: number) => pad.left + (i / (data.length - 1)) * pw;
  const cy = (w: number) => pad.top + ph - ((w - minW) / range) * ph;

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${cy(d.maxWeight).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${cx(data.length - 1).toFixed(1)} ${(pad.top + ph).toFixed(1)} L ${pad.left} ${(pad.top + ph).toFixed(1)} Z`;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d));

  const yTicks = [minW, minW + range / 2, maxW];

  // Latest occurrence of the all-time top weight — rendered as the gold PR star.
  let prIndex = 0;
  data.forEach((d, i) => {
    if (d.maxWeight >= data[prIndex].maxWeight) prIndex = i;
  });
  const lastIndex = data.length - 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="none"
      className="overflow-visible"
    >
      <defs>
        {/* Aurora sweep — teal through cyan into indigo along the timeline */}
        <linearGradient
          id="chartStroke"
          x1={pad.left} y1="0" x2={pad.left + pw} y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="0.6" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((v) => (
        <line
          key={v}
          x1={pad.left} y1={cy(v).toFixed(1)}
          x2={pad.left + pw} y2={cy(v).toFixed(1)}
          stroke="rgba(255,255,255,0.07)" strokeWidth="1"
        />
      ))}

      {yTicks.map((v, i) => (
        <text
          key={i}
          x={pad.left - 4} y={cy(v) + 3}
          textAnchor="end" fill="rgba(206,213,248,0.45)" fontSize="8"
        >
          {Math.round(v)}
        </text>
      ))}

      <path d={areaPath} fill="url(#chartGrad)" />

      <path
        d={linePath}
        fill="none"
        stroke="url(#chartStroke)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {data.map((d, i) =>
        i === prIndex ? null : (
          <circle
            key={i}
            cx={cx(i).toFixed(1)}
            cy={cy(d.maxWeight).toFixed(1)}
            r={i === lastIndex ? 3.2 : 2.4}
            fill={i === lastIndex ? '#a5f3fc' : '#67e8f9'}
            opacity={i === lastIndex ? 1 : 0.85}
          />
        ),
      )}
      {/* glow halo on the latest session */}
      {prIndex !== lastIndex && (
        <circle
          cx={cx(lastIndex).toFixed(1)}
          cy={cy(data[lastIndex].maxWeight).toFixed(1)}
          r="7"
          fill="#22d3ee"
          opacity="0.22"
        />
      )}
      {/* the PR burns gold */}
      <circle
        cx={cx(prIndex).toFixed(1)}
        cy={cy(data[prIndex].maxWeight).toFixed(1)}
        r="7"
        fill="#fde047"
        opacity="0.28"
      />
      <circle
        cx={cx(prIndex).toFixed(1)}
        cy={cy(data[prIndex].maxWeight).toFixed(1)}
        r="3.4"
        fill="#fde047"
      />

      <text x={pad.left} y={H - 2} textAnchor="start" fill="rgba(206,213,248,0.45)" fontSize="8">
        {fmt(data[0].date)}
      </text>
      <text x={pad.left + pw} y={H - 2} textAnchor="end" fill="rgba(206,213,248,0.45)" fontSize="8">
        {fmt(data[data.length - 1].date)}
      </text>
    </svg>
  );
}
