'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card-lg relative overflow-hidden p-8 text-center mt-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-card-lg"
        style={{
          background:
            'radial-gradient(220px 130px at 50% 0%, rgba(139,92,246,0.10), transparent 70%)',
        }}
      />
      <div className="relative">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-card border border-app-border bg-white/[0.04]"
        >
          <span className="glow-violet text-2xl leading-none">✷</span>
        </div>
        <p className="section-label mb-1.5">Signal interference</p>
        <h1 className="font-round text-lg font-bold tracking-tight text-app-tx1">
          Something flared out
        </h1>
        <p className="text-app-tx2 text-sm mt-1.5 leading-relaxed">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <p className="text-app-tx3 text-xs mt-1">Your data is safe on this device.</p>
        <button
          onClick={() => reset()}
          className="btn-primary px-6 mt-5 text-sm pressable"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
