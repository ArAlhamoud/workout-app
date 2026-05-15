'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function IconHome({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10L12 3l9 7v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
      <polyline points="9 21 9 13 15 13 15 21" />
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
      className={`flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
        active ? 'text-white' : 'text-gray-600 hover:text-gray-400'
      }`}
    >
      <div className={`transition-transform duration-150 ${active ? 'scale-110' : ''}`}>
        {icon}
      </div>
      <span className={`text-[9px] font-bold tracking-widest uppercase ${active ? 'text-white' : 'text-gray-700'}`}>
        {label}
      </span>
    </Link>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  const isHome = pathname === '/';
  const isHistory = pathname.startsWith('/workouts') && !pathname.startsWith('/workouts/new');
  const isLog = pathname.startsWith('/workouts/new');
  const isProgram = pathname === '/program';
  const isStats = pathname === '/stats';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-lg mx-auto relative">
        {/* Floating action button — raised above the bar */}
        <Link
          href="/workouts/new"
          className={`absolute left-1/2 -translate-x-1/2 -top-6 w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all active:scale-90 ring-[3px] ring-gray-950 shadow-[0_2px_16px_rgba(0,0,0,0.5)] ${
            isLog
              ? 'bg-blue-500'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </Link>

        <div className="bg-gray-950/96 backdrop-blur-md border-t border-gray-800/70 shadow-2xl">
          <div className="grid grid-cols-5 h-[58px]">
            <Tab href="/" label="Home" icon={<IconHome active={isHome} />} active={isHome} />
            <Tab href="/workouts" label="History" icon={<IconHistory active={isHistory} />} active={isHistory} />
            {/* Center spacer for FAB */}
            <div />
            <Tab href="/program" label="Program" icon={<IconProgram active={isProgram} />} active={isProgram} />
            <Tab href="/stats" label="Stats" icon={<IconStats active={isStats} />} active={isStats} />
          </div>
        </div>
      </div>
    </nav>
  );
}
