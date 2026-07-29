'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card-lg p-8 text-center mt-8">
      <div className="text-3xl mb-3">⚠️</div>
      <h1 className="text-lg font-bold text-app-tx1">Something went wrong</h1>
      <p className="text-app-tx2 text-sm mt-1.5 leading-relaxed">
        {error.message || 'An unexpected error occurred. Your data is safe.'}
      </p>
      <button
        onClick={() => reset()}
        className="btn-primary px-6 mt-5 text-sm pressable"
      >
        Try again
      </button>
    </div>
  );
}
