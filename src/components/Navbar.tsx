'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function IconHome({ active }: { active: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10L12 3l9 7v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
      <polyline points="9 21 9 13 15 13 15 21" fill={active ? 'var(--app-bg)' : 'none'} stroke={active ? 'var(--app-bg)' : 'none'} strokeWidth="1.8" />
    </svg>
  );
}

function IconHistory({ active }: { active: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

function IconProgram({ active }: { active: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="12" y2="16" />
    </svg>
  );
}

function IconStats({ active }: { active: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function Tab({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`flex flex-col items-center justify-center rounded-[20px] my-1.5 mx-1 transition-all duration-200 active:scale-95 ${
        active ? 'text-acc-teal bg-acc-teal/10' : 'text-app-tx3 hover:text-app-tx2'
      }`}
    >
      <div className={active ? '[filter:drop-shadow(0_0_6px_rgba(94,234,212,0.8))]' : ''}>
        {icon}
      </div>
    </Link>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  const isHome    = pathname === '/';
  const isHistory = pathname.startsWith('/workouts') && !pathname.startsWith('/workouts/new');
  const isLog     = pathname.startsWith('/workouts/new');
  const isProgram = pathname === '/program';
  const isStats   = pathname === '/stats';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 print:hidden">
      {/* Fade into deep space behind the bar */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#f2f0ea] via-[#f2f0ea]/70 to-transparent pointer-events-none" />
      <div className="max-w-lg mx-auto relative px-3 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
        {/* Frosted glass pill */}
        <div className="glass-overlay rounded-[28px] border border-app-border shadow-nav">
          <div className="grid grid-cols-5 h-[54px]">
            <Tab href="/"        label="Home"    icon={<IconHome    active={isHome}    />} active={isHome}    />
            <Tab href="/workouts" label="History" icon={<IconHistory active={isHistory} />} active={isHistory} />
            {/* One entry point. The sheet this replaced offered a 2x3 grid of
                day x duration, but /workouts/new already resolves the queued day
                and its default length — so the grid asked a question the app had
                already answered, in a second place, with its own layering bugs. */}
            <div className="flex items-center justify-center">
              <Link
                href="/workouts/new"
                aria-label="Start a workout"
                className="flex h-12 w-12 items-center justify-center rounded-full transition-all active:scale-90 border-2 border-ink bg-acc-teal-deep shadow-[3px_3px_0_#0b0b0f] hover:brightness-105"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0b1120" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </Link>
            </div>
            <Tab href="/program" label="Program"  icon={<IconProgram active={isProgram} />} active={isProgram} />
            <Tab href="/stats"   label="Stats"    icon={<IconStats   active={isStats}   />} active={isStats}   />
          </div>
        </div>
      </div>
    </nav>
  );
}
