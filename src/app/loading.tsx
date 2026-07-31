/* Glass skeletons — shimmer honors prefers-reduced-motion via motion-safe */
function SkeletonCard({ className }: { className: string }) {
  return (
    <div className={`card motion-safe:animate-pulse p-4 ${className}`}>
      <div className="h-2.5 w-24 rounded-full bg-white/[0.07]" />
      <div className="mt-3 h-6 w-36 rounded-lg bg-white/[0.06]" />
      <div className="mt-3 space-y-2">
        <div className="h-2.5 w-full rounded-full bg-white/[0.05]" />
        <div className="h-2.5 w-3/4 rounded-full bg-white/[0.05]" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-4 pt-1">
      <SkeletonCard className="h-24 overflow-hidden" />
      <SkeletonCard className="h-40 overflow-hidden" />
      <SkeletonCard className="h-40 overflow-hidden" />
    </div>
  );
}
