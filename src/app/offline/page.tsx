import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Offline · Workout Tracker',
};

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="card-lg px-6 py-8 w-full">
        <div className="w-14 h-14 mx-auto rounded-card bg-app-surface2 border border-app-border flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2DD4BF"
            strokeWidth="2"
            strokeLinecap="round"
            className="w-7 h-7"
            aria-hidden="true"
          >
            <path d="M1 1l22 22" />
            <path d="M8.5 16.5a5 5 0 0 1 7 0" />
            <path d="M5 12.5a10 10 0 0 1 3.2-2.1M12 8a10 10 0 0 1 7 2.9" />
            <path d="M2 8.8A15 15 0 0 1 5.7 6.4M12 4a15 15 0 0 1 10 4.8" />
            <circle cx="12" cy="20" r="1" fill="#2DD4BF" stroke="none" />
          </svg>
        </div>
        <h1 className="text-app-tx1 font-bold text-xl mt-5">You&apos;re offline</h1>
        <p className="text-app-tx2 text-sm mt-2 leading-relaxed">
          Your draft is safe on this device; reconnect to sync.
        </p>
      </div>
    </div>
  );
}
