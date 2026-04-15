import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-10">
      <div className="container mx-auto px-4 max-w-2xl flex items-center justify-between h-14">
        <Link href="/" className="font-bold text-white text-sm tracking-tight">
          WorkoutTracker
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/program"
            className="text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 text-sm transition-colors"
          >
            Program
          </Link>
          <Link
            href="/workouts"
            className="text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 text-sm transition-colors"
          >
            History
          </Link>
          <Link
            href="/workouts/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ml-1"
          >
            + Log
          </Link>
        </div>
      </div>
    </nav>
  );
}
