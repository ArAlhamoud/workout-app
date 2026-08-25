// The health module's face on the Home screen — glance rule: two short
// lines plus numbers, everything else behind the tap. Server component;
// the page passes precomputed facts so Home adds zero extra queries
// beyond the one injections read.

import Link from 'next/link';
import { siteLabel } from '@/lib/health-insights';

export default function HealthHomeCard({
  weekLabel,
  doseLine,
  nextLine,
  site,
  started,
}: {
  weekLabel: string;
  doseLine: string;
  nextLine: string;
  site: string | null;
  started: boolean;
}) {
  return (
    <Link
      href="/health"
      className="card-lg block px-4 py-3.5 transition-colors hover:border-app-border-hi"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <p className="section-label">Health · Mounjaro</p>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-acc-cyan/80">
          {weekLabel}
        </span>
      </div>
      <p className="text-sm text-app-tx1">
        {started ? (
          <>
            <b>{doseLine}</b>
            <span className="text-app-tx2"> · next {nextLine}</span>
            {site && <span className="text-app-tx3"> · {siteLabel(site)}</span>}
          </>
        ) : (
          <>
            <b>Starting today.</b>
            <span className="text-app-tx2"> Log the first 2.5 mg dose to start the clock →</span>
          </>
        )}
      </p>
    </Link>
  );
}
