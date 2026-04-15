import Link from 'next/link';
import { DAY_A, DAY_B, SCHEDULE, PROGRESSION, CARDIO } from '@/lib/program';

const badgeColors: Record<string, string> = {
  BEST: 'bg-green-900/50 text-green-300',
  GREAT: 'bg-blue-900/50 text-blue-300',
  GOOD: 'bg-yellow-900/50 text-yellow-300',
  CAUTION: 'bg-red-900/50 text-red-300',
};

const phaseColors: Record<string, string> = {
  LEARN: 'bg-gray-800 text-gray-300',
  BUILD: 'bg-blue-900/50 text-blue-300',
  PUSH: 'bg-green-900/50 text-green-300',
  DELOAD: 'bg-yellow-900/50 text-yellow-300',
  REBUILD: 'bg-violet-900/50 text-violet-300',
  EVALUATE: 'bg-orange-900/50 text-orange-300',
};

export default function ProgramPage() {
  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-1">
          12-Week Fat Loss
        </p>
        <h1 className="text-2xl font-black text-white">Your Program</h1>
      </div>

      {/* Weekly Schedule */}
      <section>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          Weekly Schedule
        </p>
        <div className="grid grid-cols-7 gap-1">
          {SCHEDULE.map((s) => (
            <div
              key={s.day}
              className={`rounded-xl p-2 text-center ${
                s.type === 'gym'
                  ? s.workout && s.workout.includes('A')
                    ? 'bg-blue-600/15 border border-blue-700/40'
                    : 'bg-violet-700/15 border border-violet-700/40'
                  : 'bg-gray-900 border border-gray-800'
              }`}
            >
              <div className="text-xs text-gray-500 font-medium">{s.day}</div>
              {s.workout ? (
                <div
                  className={`text-sm font-black mt-0.5 ${
                    s.workout.includes('A') ? 'text-blue-400' : 'text-violet-400'
                  }`}
                >
                  {s.workout}
                </div>
              ) : (
                <div className="text-xs text-gray-700 mt-1">—</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Day A */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold">Day A</p>
            <h2 className="text-white font-bold text-lg">{DAY_A.focus}</h2>
          </div>
          <Link
            href="/workouts/new?day=A"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            Start →
          </Link>
        </div>
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-3 mb-3">
          <span className="text-gray-500 uppercase tracking-wide font-semibold text-xs">Warm-up: </span>
          <span className="text-gray-400 text-xs">{DAY_A.warmup}</span>
        </div>
        <div className="space-y-2">
          {DAY_A.exercises.map((ex, i) => (
            <div key={ex.name} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">{ex.name}</span>
                    <span className="text-xs bg-blue-600/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-700/40">
                      {ex.sets}×{ex.repsDisplay}
                    </span>
                  </div>
                  <div className="text-gray-500 text-xs mt-1">
                    {ex.machine} · {ex.rest} rest
                  </div>
                  <div className="text-gray-400 text-xs mt-1.5 leading-relaxed">{ex.cues}</div>
                </div>
                <div className="text-gray-700 text-lg font-black flex-shrink-0 tabular-nums">
                  {i + 1}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-3 mt-3">
          <span className="text-gray-500 uppercase tracking-wide font-semibold text-xs">
            Cardio finisher:{' '}
          </span>
          <span className="text-gray-400 text-xs">{DAY_A.cardioFinisher}</span>
        </div>
      </section>

      {/* Day B */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold">Day B</p>
            <h2 className="text-white font-bold text-lg">{DAY_B.focus}</h2>
          </div>
          <Link
            href="/workouts/new?day=B"
            className="bg-violet-700 hover:bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            Start →
          </Link>
        </div>
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-3 mb-3">
          <span className="text-gray-500 uppercase tracking-wide font-semibold text-xs">Warm-up: </span>
          <span className="text-gray-400 text-xs">{DAY_B.warmup}</span>
        </div>
        <div className="space-y-2">
          {DAY_B.exercises.map((ex, i) => (
            <div key={ex.name} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">{ex.name}</span>
                    <span className="text-xs bg-violet-700/20 text-violet-300 px-2 py-0.5 rounded-full border border-violet-700/40">
                      {ex.sets}×{ex.repsDisplay}
                    </span>
                  </div>
                  <div className="text-gray-500 text-xs mt-1">
                    {ex.machine} · {ex.rest} rest
                  </div>
                  <div className="text-gray-400 text-xs mt-1.5 leading-relaxed">{ex.cues}</div>
                </div>
                <div className="text-gray-700 text-lg font-black flex-shrink-0 tabular-nums">
                  {i + 1}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-3 mt-3">
          <span className="text-gray-500 uppercase tracking-wide font-semibold text-xs">
            Cardio finisher:{' '}
          </span>
          <span className="text-gray-400 text-xs">{DAY_B.cardioFinisher}</span>
        </div>
      </section>

      {/* 12-Week Progression */}
      <section>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          12-Week Progression
        </p>
        <div className="space-y-2">
          {PROGRESSION.map((p) => (
            <div
              key={p.weeks}
              className="bg-gray-900 rounded-xl p-4 border border-gray-800 flex items-start gap-3"
            >
              <div
                className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  phaseColors[p.phase] || 'bg-gray-800 text-gray-300'
                }`}
              >
                {p.phase}
              </div>
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-0.5">Week {p.weeks}</div>
                <div className="text-gray-300 text-xs leading-relaxed">{p.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Cardio Rankings */}
      <section>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          Cardio Rankings
        </p>
        <div className="space-y-2">
          {CARDIO.map((c) => (
            <div
              key={c.name}
              className="bg-gray-900 rounded-xl p-4 border border-gray-800 flex items-start gap-3"
            >
              <div className="text-gray-700 font-black text-lg w-5 flex-shrink-0 tabular-nums">
                {c.rank}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-semibold text-sm">{c.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      badgeColors[c.badge] || 'bg-gray-800 text-gray-300'
                    }`}
                  >
                    {c.badge}
                  </span>
                </div>
                <div className="text-gray-400 text-xs mt-1">{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Nutrition Guide */}
      <section>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          Nutrition Guide
        </p>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <div className="text-white font-semibold text-sm mb-1">Calorie Target</div>
            <div className="text-gray-400 text-xs">
              ~1,800–2,000 kcal/day (adjust based on hunger & progress)
            </div>
          </div>
          <div className="p-4 border-b border-gray-800">
            <div className="text-white font-semibold text-sm mb-3">Daily Macros</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-800/30">
                <div className="text-blue-400 font-bold text-lg">~130g</div>
                <div className="text-gray-500 text-xs mt-0.5">Protein</div>
              </div>
              <div className="bg-yellow-900/20 rounded-lg p-3 border border-yellow-800/30">
                <div className="text-yellow-400 font-bold text-lg">~200g</div>
                <div className="text-gray-500 text-xs mt-0.5">Carbs</div>
              </div>
              <div className="bg-green-900/20 rounded-lg p-3 border border-green-800/30">
                <div className="text-green-400 font-bold text-lg">~50g</div>
                <div className="text-gray-500 text-xs mt-0.5">Fat</div>
              </div>
            </div>
          </div>
          <div className="p-4">
            <div className="text-white font-semibold text-sm mb-2">Rules</div>
            <ul className="space-y-1.5 text-gray-400 text-xs">
              <li>· Protein at every meal — chicken, eggs, Greek yogurt, legumes</li>
              <li>· Vegetables fill half the plate</li>
              <li>· Eat within 60 min after each workout</li>
              <li>· Limit ultra-processed foods — not zero, just not daily</li>
              <li>· Drink 2–3 L water/day</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
