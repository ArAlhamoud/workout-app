import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card-lg relative overflow-hidden p-8 text-center mt-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-card-lg"
        style={{
          background:
            'radial-gradient(220px 130px at 50% 0%, rgba(45,212,191,0.08), transparent 70%)',
        }}
      />
      <div className="relative">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-card border border-app-border bg-white/[0.04]"
        >
          <span className="glow-teal text-2xl leading-none">✧</span>
        </div>
        <p className="section-label mb-1.5">Empty sky</p>
        <h1 className="font-round text-lg font-bold tracking-tight text-app-tx1">
          Nothing at these coordinates
        </h1>
        <p className="text-app-tx2 text-sm mt-1.5">
          This page drifted out of orbit — it may have been deleted.
        </p>
        <Link
          href="/"
          className="inline-block btn-primary px-6 mt-5 text-sm pressable"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
