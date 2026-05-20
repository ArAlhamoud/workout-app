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
          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold group-hover:text-gray-400 transition-colors">
            {title}
          </p>
          {badge && (
            <span className="text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded-full border border-gray-700">
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
          className={`text-gray-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
