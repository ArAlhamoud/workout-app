'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LogWorkoutSheet from './LogWorkoutSheet';

function IconHome({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10L12 3l9 7v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
      <polyline points="9 21 9 13 15 13 15 21" fill={active ? 'var(--app-bg)' : 'none'} stroke={active ? 'var(--app-bg)' : 'none'} strokeWidth="1.8" />
    </svg>
  );
}

function IconHistory({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

function IconProgram({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="12" y2="16" />
    </svg>
  );
}

function IconStats({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
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
      className="flex flex-col items-center justify-center gap-1 relative transition-all active:scale-95"
    >
      {/* Teal top indicator bar */}
      <span
        className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all duration-300 ${
          active ? 'w-6 bg-teal-400' : 'w-0 bg-transparent'
        }`}
      />
      <div className={`transition-all duration-200 ${active ? 'text-teal-400 scale-110' : 'text-app-tx3 hover:text-app-tx2'}`}>
        {icon}
      </div>
      <span className={`text-[9px] font-bold tracking-widest uppercase transition-colors duration-200 ${
        active ? 'text-teal-400' : 'text-app-tx3'
      }`}>
        {label}
      </span>
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
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-lg mx-auto relative">
        <LogWorkoutSheet />
        {/* Frosted glass bar */}
        <div className="bg-app-surface/95 backdrop-blur-xl border-t border-app-border">
          <div className="grid grid-cols-5 h-[60px]">
            <Tab href="/"        label="Home"    icon={<IconHome    active={isHome}    />} active={isHome}    />
            <Tab href="/workouts" label="History" icon={<IconHistory active={isHistory} />} active={isHistory} />
            {/* Center spacer for FAB */}
            <div />
            <Tab href="/program" label="Program"  icon={<IconProgram active={isProgram} />} active={isProgram} />
            <Tab href="/stats"   label="Stats"    icon={<IconStats   active={isStats}   />} active={isStats}   />
          </div>
        </div>
      </div>
    </nav>
  );
}
