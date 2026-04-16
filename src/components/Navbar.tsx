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

function IconHistory({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  const isHome = pathname === '/';
  const isProgram = pathname === '/program';
  const isHistory = pathname.startsWith('/workouts') && !pathname.startsWith('/workouts/new');
  const isLog = pathname.startsWith('/workouts/new');

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/98 backdrop-blur-sm border-t border-gray-800">
      <div className="grid grid-cols-4 max-w-lg mx-auto" style={{ height: '60px' }}>
        <Link
          href="/"
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${isHome ? 'text-white' : 'text-gray-600 hover:text-gray-400'}`}
        >
          <IconHome active={isHome} />
          <span className="text-[10px] font-semibold tracking-wide">HOME</span>
        </Link>

        <Link
          href="/program"
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${isProgram ? 'text-white' : 'text-gray-600 hover:text-gray-400'}`}
        >
          <IconProgram active={isProgram} />
          <span className="text-[10px] font-semibold tracking-wide">PROGRAM</span>
        </Link>

        <Link
          href="/workouts"
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${isHistory ? 'text-white' : 'text-gray-600 hover:text-gray-400'}`}
        >
          <IconHistory active={isHistory} />
          <span className="text-[10px] font-semibold tracking-wide">HISTORY</span>
        </Link>

        <Link
          href="/workouts/new"
          className="flex flex-col items-center justify-center gap-1"
        >
          <div className={`w-10 h-7 rounded-lg flex items-center justify-center transition-colors ${isLog ? 'bg-blue-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
            <IconPlus />
          </div>
          <span className={`text-[10px] font-semibold tracking-wide transition-colors ${isLog ? 'text-blue-400' : 'text-blue-500'}`}>
            LOG
          </span>
        </Link>
      </div>
    </nav>
  );
}
