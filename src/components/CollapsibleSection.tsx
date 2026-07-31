'use client';

import { useState } from 'react';

export default function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-1 mb-3 group"
      >
        <div className="flex items-center gap-2">
          <p className="section-label group-hover:text-app-tx2 transition-colors">
            {title}
          </p>
          {badge && (
            <span className="text-[10px] bg-white/[0.06] text-app-tx2 px-2 py-0.5 rounded-full border border-app-border">
              {badge}
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`text-app-tx3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
