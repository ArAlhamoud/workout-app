import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="container mx-auto px-4 max-w-5xl flex items-center justify-between h-16">
        <Link href="/" className="text-xl font-bold text-white hover:text-blue-400 transition-colors">
          WorkoutTracker
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/workouts" className="text-gray-300 hover:text-white transition-colors">
            Workouts
          </Link>
          <Link href="/exercises" className="text-gray-300 hover:text-white transition-colors">
            Exercises
          </Link>
          <Link
            href="/workouts/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Log Workout
          </Link>
        </div>
      </div>
    </nav>
  );
}
