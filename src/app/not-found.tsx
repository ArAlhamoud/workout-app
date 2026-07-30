import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card-lg p-8 text-center mt-8">
      <div className="text-3xl mb-3">🔍</div>
      <h1 className="text-lg font-bold text-app-tx1">Page not found</h1>
      <p className="text-app-tx2 text-sm mt-1.5">
        This page doesn&apos;t exist — it may have been deleted.
      </p>
      <Link
        href="/"
        className="inline-block btn-primary px-6 mt-5 text-sm pressable"
      >
        Back home
      </Link>
    </div>
  );
}
