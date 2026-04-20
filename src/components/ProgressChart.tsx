interface DataPoint {
  date: Date;
  maxWeight: number;
  reps: number;
  sessionName: string;
}

export default function ProgressChart({ data }: { data: DataPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-600 text-sm">
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

  // Y-axis: 3 labels
  const yTicks = [minW, minW + range / 2, maxW];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="none"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map((v) => (
        <line
          key={v}
          x1={pad.left} y1={cy(v).toFixed(1)}
          x2={pad.left + pw} y2={cy(v).toFixed(1)}
          stroke="#1f2937" strokeWidth="1"
        />
      ))}

      {/* Y labels */}
      {yTicks.map((v, i) => (
        <text
          key={i}
          x={pad.left - 4} y={cy(v) + 3}
          textAnchor="end" fill="#4b5563" fontSize="8"
        >
          {Math.round(v)}
        </text>
      ))}

      {/* Area */}
      <path d={areaPath} fill="url(#chartGrad)" />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={cx(i).toFixed(1)}
          cy={cy(d.maxWeight).toFixed(1)}
          r="3"
          fill="#3b82f6"
        />
      ))}

      {/* X labels: first and last */}
      <text x={pad.left} y={H - 2} textAnchor="start" fill="#4b5563" fontSize="8">
        {fmt(data[0].date)}
      </text>
      <text x={pad.left + pw} y={H - 2} textAnchor="end" fill="#4b5563" fontSize="8">
        {fmt(data[data.length - 1].date)}
      </text>
    </svg>
  );
}
