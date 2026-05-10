import Link from 'next/link';
import { DAY_A, DAY_B, SCHEDULE, PROGRESSION, CARDIO, type Priority } from '@/lib/program';
import { getExercises } from '@/app/actions';

const priorityBadge: Record<Priority, { label: string; cls: string }> = {
  1: { label: 'Always', cls: 'bg-green-900/40 text-green-300 border-green-800/40' },
  2: { label: '45+ min', cls: 'bg-blue-900/40 text-blue-300 border-blue-800/40' },
  3: { label: '60 min', cls: 'bg-gray-800 text-gray-400 border-gray-700' },
};

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

export default async function ProgramPage() {
  const exercises = await getExercises();
  const exerciseIdByName = new Map(exercises.map((e) => [e.name, e.id]));

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
          {DAY_A.exercises.map((ex, i) => {
            const exId = exerciseIdByName.get(ex.name);
            const pb = priorityBadge[ex.priority];
            return (
              <div key={ex.name} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">{ex.name}</span>
                      <span className="text-xs bg-blue-600/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-700/40">
                        {ex.sets}×{ex.repsDisplay}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${pb.cls}`}>
                        {pb.label}
                      </span>
                      {exId && (
                        <Link href={`/progress/${exId}`} className="text-xs text-gray-600 hover:text-blue-400 transition-colors">
                          Progress →
                        </Link>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs mt-1">{ex.machine} · {ex.rest} rest</div>
                    <div className="text-gray-400 text-xs mt-1.5 leading-relaxed">{ex.cues}</div>
                  </div>
                  <div className="text-gray-700 text-lg font-black flex-shrink-0 tabular-nums">{i + 1}</div>
                </div>
              </div>
            );
          })}
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
          {DAY_B.exercises.map((ex, i) => {
            const exId = exerciseIdByName.get(ex.name);
            const pb = priorityBadge[ex.priority];
            return (
              <div key={ex.name} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">{ex.name}</span>
                      <span className="text-xs bg-violet-700/20 text-violet-300 px-2 py-0.5 rounded-full border border-violet-700/40">
                        {ex.sets}×{ex.repsDisplay}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${pb.cls}`}>
                        {pb.label}
                      </span>
                      {exId && (
                        <Link href={`/progress/${exId}`} className="text-xs text-gray-600 hover:text-violet-400 transition-colors">
                          Progress →
                        </Link>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs mt-1">{ex.machine} · {ex.rest} rest</div>
                    <div className="text-gray-400 text-xs mt-1.5 leading-relaxed">{ex.cues}</div>
                  </div>
                  <div className="text-gray-700 text-lg font-black flex-shrink-0 tabular-nums">{i + 1}</div>
                </div>
              </div>
            );
          })}
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

      {/* Your Profile */}
      <section>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          Your Profile
        </p>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-gray-800">
            <div className="p-3 text-center">
              <div className="text-white font-bold text-base">132 kg</div>
              <div className="text-gray-500 text-xs mt-0.5">Weight</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-white font-bold text-base">169 cm</div>
              <div className="text-gray-500 text-xs mt-0.5">Height</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-white font-bold text-base">37 yrs</div>
              <div className="text-gray-500 text-xs mt-0.5">Age</div>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-800 border-t border-gray-800">
            <div className="p-3 text-center">
              <div className="text-orange-400 font-bold text-base">BMI 46</div>
              <div className="text-gray-500 text-xs mt-0.5">Class III</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-green-400 font-bold text-base">Fat Loss</div>
              <div className="text-gray-500 text-xs mt-0.5">Goal</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-blue-400 font-bold text-base">Desk</div>
              <div className="text-gray-500 text-xs mt-0.5">Lifestyle</div>
            </div>
          </div>
          <div className="border-t border-gray-800 p-3">
            <div className="text-gray-500 text-xs text-center">
              TDEE ~2,635 kcal · Target deficit −600 kcal/day · ~0.5–0.7 kg/week loss
            </div>
            <div className="text-green-500 text-xs text-center mt-1 font-semibold">
              Down 3 kg from start — keep going!
            </div>
          </div>
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
              ~2,050 kcal/day — calculated from your TDEE (2,635) minus a 600 kcal deficit
            </div>
          </div>
          <div className="p-4 border-b border-gray-800">
            <div className="text-white font-semibold text-sm mb-3">Daily Macros</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-800/30">
                <div className="text-blue-400 font-bold text-lg">160g</div>
                <div className="text-gray-500 text-xs mt-0.5">Protein</div>
                <div className="text-gray-700 text-xs">640 kcal</div>
              </div>
              <div className="bg-yellow-900/20 rounded-lg p-3 border border-yellow-800/30">
                <div className="text-yellow-400 font-bold text-lg">205g</div>
                <div className="text-gray-500 text-xs mt-0.5">Carbs</div>
                <div className="text-gray-700 text-xs">820 kcal</div>
              </div>
              <div className="bg-green-900/20 rounded-lg p-3 border border-green-800/30">
                <div className="text-green-400 font-bold text-lg">65g</div>
                <div className="text-gray-500 text-xs mt-0.5">Fat</div>
                <div className="text-gray-700 text-xs">585 kcal</div>
              </div>
            </div>
          </div>
          <div className="p-4 border-b border-gray-800">
            <div className="text-white font-semibold text-sm mb-2">Rules</div>
            <ul className="space-y-1.5 text-gray-400 text-xs">
              <li>· Protein at every meal — chicken, eggs, Greek yogurt, legumes, cottage cheese</li>
              <li>· Vegetables fill half the plate — non-negotiable</li>
              <li>· Eat within 60 min after each workout (prioritise protein)</li>
              <li>· Limit ultra-processed foods — not zero, just not daily</li>
              <li>· Drink 3–4 L water/day (higher at your bodyweight)</li>
              <li>· Don’t eat back gym calories — deficit is already moderate</li>
            </ul>
          </div>
          <div className="p-4">
            <div className="text-white font-semibold text-sm mb-2">Joint-First Approach</div>
            <ul className="space-y-1.5 text-gray-400 text-xs">
              <li>· All exercises are machine-based — no free-weight barbell loading on joints</li>
              <li>· RDL only on Smith Machine or light dumbbells — learn the hinge before loading</li>
              <li>· Avoid treadmill running — walking only at 4–5 km/h, low incline</li>
              <li>· Swimming is your best cardio — zero joint impact, maximum calorie burn</li>
              <li>· Progress weight slowly — joint adaptation lags behind muscle strength</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
