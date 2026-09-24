// The Watch session core, tested on the Mac with plain swiftc — SessionCore
// is Foundation-only by design. Run: bash scripts/watch-core-tests/run.sh
import Foundation

var passed = 0, failed = 0
func check(_ cond: Bool, _ label: String) {
    if cond { passed += 1; print("  ok   \(label)") } else { failed += 1; print("  FAIL \(label)") }
}

func ex(_ id: String, _ name: String, order: Int, sets: Int = 3, repsMin: Int = 12, repsMax: Int = 15, unit: String = "reps",
        prefill: Double? = 30, reps: Int = 12, pin: Double = 2.5, crown: Double? = nil, warm: Double? = nil,
        alwaysWarm: Bool? = nil, reason: String? = nil, extra: Bool? = true) -> PlanExercise {
    PlanExercise(exerciseId: id, name: name, machine: "m", order: order, sets: sets, repsMin: repsMin, repsMax: repsMax,
                 unit: unit, restSec: 75, prefillKg: prefill, prefillReps: reps, pinKg: pin, crownStepKg: crown,
                 warmupKg: warm, alwaysWarm: alwaysWarm, reason: reason, fromKg: nil, note: nil, extraSetAllowed: extra)
}
func plan(_ exs: [PlanExercise], n: Int? = 2) -> Plan {
    Plan(day: "A", mode: "train", focus: "Day A", durationMin: 45, loadPct: 85, rpeCap: 3, exercises: exs, warmupFirstN: n, startableUntil: nil)
}
func session(_ p: Plan) -> ActiveSession {
    let slots = SessionCore.buildSlots(p)
    return ActiveSession(clientSaveId: "t", day: p.day, rpeCap: p.rpeCap, startedAt: Date(timeIntervalSince1970: 0),
                         slots: slots, currentIndex: 0, logged: [], planOrder: SessionCore.planOrder(slots),
                         loadPct: p.loadPct, durationMin: p.durationMin, warmupFirstN: p.warmupFirstN)
}
let t0 = Date(timeIntervalSince1970: 1_790_000_000)
func cur(_ s: ActiveSession) -> SetSlot? { s.currentIndex < s.slots.count ? s.slots[s.currentIndex] : nil }

print("Watch core — warm-ups (trainer ruling 5)")
do {
    let p = plan([
        ex("lp", "Leg Press", order: 0, prefill: 36, warm: 17.5),
        ex("cp", "Chest Press", order: 1, prefill: 18, warm: 9),
        ex("sp", "Shoulder Press", order: 2, prefill: 27, warm: 12.5),
        ex("pl", "Plank", order: 3, unit: "seconds", prefill: nil, reps: 21),
    ])
    var s = session(p)
    check(cur(s)?.isWarmup == true && cur(s)?.weightKg == 17.5, "the first machine opens on its warm-up at the warm-up weight")
    check(s.planOrder == ["lp", "cp", "sp", "pl"], "a warm-up slot does not change the machine counter's order")
    let w = SessionCore.log(&s, now: t0)
    check(w?.isWarmup == true && w?.setNumber == 0, "a logged warm-up is flagged isWarmup, set 0 (was isWarmup false)")
    check(s.slots[s.currentIndex...].filter { $0.exerciseId == "lp" }.allSatisfy { $0.weightKg == 36 }, "logging the warm-up leaves the working sets at 36 (was 17.5 on every set)")
    check(cur(s)?.isLastOfExercise == false && w.map { _ in true } == true, "a warm-up never asks for a rating")
    // Occupied: rotate to Shoulder Press, which he STARTS second.
    SessionCore.rotate(&s, forward: true)
    check(cur(s)?.exerciseId == "cp" && cur(s)?.isWarmup == true, "mid-machine rotation moves Leg Press's working sets back")
    SessionCore.rotate(&s, forward: true)
    check(cur(s)?.exerciseId == "sp" && cur(s)?.isWarmup == true, "the machine he starts second gets its warm-up, whatever its plan position")
    SessionCore.log(&s, now: t0)
    check(!s.slots[s.currentIndex...].contains { $0.isWarmup && $0.exerciseId == "cp" }, "once two machines are started the third's warm-up retires")
    check(!s.slots.contains { $0.isWarmup && $0.exerciseId == "pl" }, "a timed hold never gets a warm-up")
}
do {
    var s = session(plan([
        ex("lp", "Leg Press", order: 0, warm: 15), ex("cp", "Chest Press", order: 1, warm: 9),
        ex("be", "Back Extension", order: 2, warm: 15, alwaysWarm: true),
    ]))
    for _ in 0..<4 { SessionCore.log(&s, now: t0) }  // lp warm + 3
    SessionCore.log(&s, now: t0)                      // cp warm
    check(s.slots[s.currentIndex...].contains { $0.isWarmup && $0.exerciseId == "be" }, "Back Extension keeps its warm-up however late it comes")
}

do {
    var s = session(plan([ex("lp", "Leg Press", order: 0, prefill: 36, warm: 17.5)]))
    check(SessionCore.skipWarmup(&s) && cur(s)?.setNumber == 1 && s.logged.isEmpty, "skip warm-up drops it, logs nothing")
    check(!SessionCore.skipWarmup(&s), "skip only applies to a warm-up card")
}

print("Watch core — reps and weight carry forward (B5)")
do {
    var s = session(plan([ex("lp", "Leg Press", order: 0, prefill: 36, reps: 12)]))
    s.slots[s.currentIndex].reps = 14
    s.slots[s.currentIndex].weightKg = 37.5
    SessionCore.log(&s, now: t0)
    check(cur(s)?.reps == 14 && cur(s)?.weightKg == 37.5, "set 1's reps and weight carry to set 2 (reps used to reset to the prefill)")
    var slot = SessionCore.buildSlots(plan([ex("mr", "Mid Row", order: 0, repsMin: 10, repsMax: 12, reps: 10)]))[0]
    check(SessionCore.decrementedReps(slot) == 9, "a long-press records a short set below repsMin")
    slot.reps = 1
    check(SessionCore.decrementedReps(slot) == 1, "never below one rep")
    slot.reps = 12
    check(SessionCore.cycledReps(slot) == 10, "a tap still wraps from repsMax to repsMin")
    slot.reps = 8
    check(SessionCore.cycledReps(slot) == 9, "from below repsMin a tap climbs back toward it")
}

print("Watch core — the crown (B7): relative, one detent = one step")
do {
    func slot(_ w: Double, crown: Double?) -> SetSlot {
        SessionCore.buildSlots(plan([ex("x", "X", order: 0, prefill: w, crown: crown)], n: 0))[0]
    }
    for (w, step) in [(30.0, 9.0), (29, 9), (35, 7.5), (27.5, 4.5), (8.75, 1.25), (27, 0.5), (23, 4.5)] {
        let sl = slot(w, crown: step)
        check(SessionCore.nudgedWeight(sl, detents: 1) == ((w + step) * 100).rounded() / 100, "\(w) + one \(step) detent")
        check(SessionCore.nudgedWeight(sl, detents: 0) == w, "\(w): no turn, no settle (the old grid pulled it to a multiple of the step)")
        var up = sl
        for _ in 0..<25 { up.weightKg = SessionCore.nudgedWeight(up, detents: 1) }
        for _ in 0..<25 { up.weightKg = SessionCore.nudgedWeight(up, detents: -1) }
        check(up.weightKg == w, "\(w): 25 up and 25 down lands exactly back (no drift)")
    }
    check(SessionCore.nudgedWeight(slot(27, crown: nil), detents: 1) == 27.5, "an unconfirmed machine moves 0.5 kg per detent")
    check(SessionCore.nudgedWeight(slot(5, crown: 7.5), detents: -1) == 5, "past zero is a wall, not a clamp — the ladder survives")
    check(SessionCore.nudgedWeight(slot(27, crown: 9), detents: -3) == 0, "zero is reachable when it is on the ladder")
    check(SessionCore.nudgedWeight(slot(498, crown: 9), detents: 1) == 498, "500 kg is a wall")
    var plank = SessionCore.buildSlots(plan([ex("pl", "Plank", order: 0, unit: "seconds", prefill: nil, reps: 21)]))[0]
    check(SessionCore.nudgedSeconds(plank, detents: 1) == 22, "a 21 s plank goes to 22 s (the 5 s grid settled it to 20 or 25)")
    plank.reps = 5
    check(SessionCore.nudgedSeconds(plank, detents: -1) == 5, "5 s is the floor")
}

print("Watch core — undo (C3) and +1 set (C2)")
do {
    var s = session(plan([ex("pf", "Pec Fly", order: 0, sets: 3, prefill: 25), ex("ab", "Ab Crunch", order: 1, prefill: 25)], n: 0))
    for _ in 0..<3 { SessionCore.log(&s, now: t0) }
    _ = SessionCore.rate(&s, exerciseId: "pf", rpe: 1)
    check(SessionCore.addSet(&s, exerciseId: "pf"), "+1 set is added")
    check(cur(s)?.setNumber == 4 && cur(s)?.isLastOfExercise == true, "the extra set is next and is the new last set")
    check(s.slots.filter { $0.exerciseId == "pf" }.allSatisfy { $0.setsTotal == 4 }, "every Pec Fly slot learns the new total")
    check(!SessionCore.addSet(&s, exerciseId: "pf"), "once per machine")
    // Undo set 3 after the +1: re-logging set 3 must NOT ask for a rating while set 4 waits.
    s.currentIndex -= 0
    let undone = SessionCore.undoLast(&s)
    check(undone?.setNumber == 3 && undone?.rpe == 1, "undo takes back the last set, its rating with it")
    check(cur(s)?.setNumber == 3 && !s.logged.contains { $0.exerciseId == "pf" && $0.setNumber == 3 }, "its slot is next again and its LogSet is gone")
    check(cur(s)?.isLastOfExercise == false, "re-logged set 3 does not ask for a rating while set 4 is pending (setsTotal was a let)")
    SessionCore.log(&s, now: t0.addingTimeInterval(60))
    check(s.logged.filter { $0.exerciseId == "pf" && $0.setNumber == 3 }.count == 1, "one LogSet per key after a re-log — no duplicate reaches the server")
    check(s.logged.last?.completedAt == ISO8601DateFormatter.fractional.string(from: t0.addingTimeInterval(60)), "the re-log carries its own, later time")
}
do {
    var s = session(plan([ex("lp", "Leg Press", order: 0, prefill: 36)], n: 0))
    SessionCore.log(&s, now: t0)
    s.logged.append(LogSet(exerciseId: "lp", setNumber: 2, reps: 12, weight: 36, rpe: nil, isWarmup: false, origin: "phone"))
    let u = SessionCore.undoLast(&s)
    check(u?.origin == nil && u?.setNumber == 1, "undo never takes back a set the phone logged")
}

print("Watch core — rating keeps the set's own time")
do {
    var s = session(plan([ex("lp", "Leg Press", order: 0, sets: 1, prefill: 36)], n: 0))
    SessionCore.log(&s, now: t0)
    let rated = SessionCore.rate(&s, exerciseId: "lp", rpe: 2)
    check(rated?.completedAt == ISO8601DateFormatter.fractional.string(from: t0), "a rating re-post carries the LOG time, not the moment of the tap")
}

print("Watch core — the phone's sets")
do {
    var s = session(plan([ex("lp", "Leg Press", order: 0, prefill: 36, warm: 17.5), ex("cp", "Chest Press", order: 1, prefill: 18, warm: 9)]))
    let row = LiveSession(clientSaveId: "t", day: "A", durationMin: 45, gym: nil, source: "phone", startedAt: "2026-09-24T17:00:00.000Z",
                          updatedAt: "2026-09-24T17:10:00.000Z", closedAt: nil, workoutId: nil,
                          sets: [LiveSet(exerciseId: "lp", setNumber: 1, reps: 12, weight: 36, rpe: nil, isWarmup: false, completedAt: "2026-09-24T17:05:00.000Z", source: "phone")])
    SessionCore.merge(&s, row: row)
    check(!s.slots[s.currentIndex...].contains { $0.isWarmup && $0.exerciseId == "lp" }, "a machine the phone started loses its pending warm-up")
    check(s.slots[..<s.currentIndex].contains { $0.exerciseId == "lp" && $0.setNumber == 1 }, "the phone's set is logged in the head")
    check(s.logged.first?.completedAt == "2026-09-24T17:05:00.000Z", "a merged set keeps the phone's time")
}

print("Watch core — rest")
do {
    let past = t0.addingTimeInterval(-5)
    let r = SessionCore.restRange(now: t0, until: past)
    check(r.lowerBound <= r.upperBound, "a rest that already ended never builds an inverted range (it trapped)")
    let slots = SessionCore.buildSlots(plan([ex("lp", "Leg Press", order: 0, warm: 15)]))
    check(SessionCore.restSeconds(after: slots[0]) == 60 && SessionCore.restSeconds(after: slots[1]) == 75, "a warm-up is followed by a short rest")
}

print("Watch core — spoken lines (Siri lane)")
do {
    let slots = SessionCore.buildSlots(plan([ex("lp", "Leg Press", order: 0, prefill: 36, reps: 12, warm: 17.5),
                                             ex("fp", "Cable Face Pull", order: 1, prefill: 8.75, reps: 15),
                                             ex("pl", "Plank", order: 2, unit: "seconds", prefill: nil, reps: 21)]))
    check(SessionCore.cardLine(slots[0]) == "Leg Press, warm-up. 17.5 kilos, 12 reps.", "a warm-up card is spoken as a warm-up")
    check(SessionCore.cardLine(slots[1]) == "Leg Press, set 1 of 3. 36 kilos, 12 reps.", "a working set speaks the card's numbers")
    check(SessionCore.cardLine(slots.first { $0.exerciseId == "fp" }!) == "Cable Face Pull, set 1 of 3. 8.75 kilos, 15 reps.", "8.75 is said as 8.75, not 8.8")
    check(SessionCore.cardLine(slots.last!) == "Plank, set 3 of 3. Hold 21 seconds.", "a hold speaks seconds")
    let set = LogSet(exerciseId: "lp", setNumber: 1, reps: 12, weight: 36, rpe: nil, isWarmup: false)
    check(SessionCore.loggedLine(set, restSeconds: 120, next: slots[2]) == "Logged 36 kilos by 12. Rest 120 seconds. Next: Leg Press, set 2 of 3. 36 kilos, 12 reps.", "the reply to 'done' says what, the rest, and what is next")
    check(SessionCore.loggedLine(set, restSeconds: nil, next: nil).hasSuffix("Finish on the watch."), "after the last set it points at the watch to finish")
}

print("Watch core — review fixes (phase 4)")
do {
    // F4: undo brings back the warm-ups the undone set retired.
    var s = session(plan([ex("lp", "Leg Press", order: 0, prefill: 36, warm: 17.5),
                          ex("cp", "Chest Press", order: 1, prefill: 18, warm: 9),
                          ex("sp", "Shoulder Press", order: 2, prefill: 27, warm: 12.5)]))
    for _ in 0..<4 { SessionCore.log(&s, now: t0) }            // lp warm + 3
    SessionCore.log(&s, now: t0)                                // cp warm — the mis-tap
    check(!s.slots.contains { $0.isWarmup && $0.exerciseId == "sp" }, "logging a second machine retires the others' warm-ups")
    SessionCore.undoLast(&s)
    check(s.slots[s.currentIndex...].contains { $0.isWarmup && $0.exerciseId == "sp" }, "undoing it brings Shoulder Press's warm-up back")
    SessionCore.rotate(&s, forward: true)
    check(cur(s)?.exerciseId == "sp" && cur(s)?.isWarmup == true, "so the machine he actually starts second opens on its warm-up")
    var k = session(plan([ex("lp", "Leg Press", order: 0, prefill: 36, warm: 17.5)]))
    SessionCore.skipWarmup(&k)
    SessionCore.log(&k, now: t0)
    SessionCore.undoLast(&k)
    check(!k.slots.contains { $0.isWarmup }, "a warm-up he skipped himself never comes back")
}
do {
    // F1: live updates go out one post at a time and are acknowledged in
    // order — never a count that can drop an update still in flight.
    var q = LiveQueue()
    q.append([LiveUpdate(exerciseId: "a", setNumber: 1), LiveUpdate(exerciseId: "a", setNumber: 2)])
    let first = q.nextBatch()
    check(first?.count == 2, "the first post carries everything queued")
    q.append([LiveUpdate(exerciseId: "a", setNumber: 3)])
    check(q.nextBatch() == nil, "nothing else goes out while a post is in flight")
    q.ack(first!.count)
    let second = q.nextBatch()
    check(second?.count == 1 && second?.first?.setNumber == 3, "the next post carries only what came after")
    q.fail()
    check(q.pending.count == 1 && q.nextBatch()?.count == 1, "a failed post keeps its updates for the next try")
    // The session-opening post (no sets) is in flight too: nothing else goes
    // out beside it, and its ack drops nothing (final review F1).
    var o = LiveQueue()
    let opening = o.nextBatch(allowEmpty: true)
    check(opening?.isEmpty == true && o.isSending, "the opening post is tracked in flight")
    o.append([LiveUpdate(exerciseId: "w", setNumber: 0)])
    check(o.nextBatch() == nil, "a set logged while it is out waits for it")
    o.ack(0)
    check(o.nextBatch()?.count == 1, "then goes out, whole")
}
do {
    // T3: a cached plan cannot start a session past the moment a layoff
    // would have begun (the server says when: startableUntil).
    let json = """
    {"day":"A","mode":"train","focus":"Day A","durationMin":45,"loadPct":100,"rpeCap":4,"exercises":[],"startableUntil":"2026-10-15T00:00:00.000Z"}
    """
    let p = try! JSONDecoder().decode(Plan.self, from: Data(json.utf8))
    let f = ISO8601DateFormatter.fractional
    check(SessionCore.planStartable(p, fetchedAt: f.date(from: "2026-10-01T00:00:00.000Z")!, now: f.date(from: "2026-10-05T00:00:00.000Z")!), "inside both windows: startable offline")
    check(!SessionCore.planStartable(p, fetchedAt: f.date(from: "2026-10-01T00:00:00.000Z")!, now: f.date(from: "2026-10-16T00:00:00.000Z")!), "past startableUntil: a layoff may have begun — refuse, whatever the cache age")
    let old = try! JSONDecoder().decode(Plan.self, from: Data(json.replacingOccurrences(of: ",\"startableUntil\":\"2026-10-15T00:00:00.000Z\"", with: "").utf8))
    check(!SessionCore.planStartable(old, fetchedAt: f.date(from: "2026-10-01T00:00:00.000Z")!, now: f.date(from: "2026-10-09T00:00:00.000Z")!), "a plan without the field keeps the 7-day window")
}

print("Watch core — HealthKit restarts stay honest (rule 11)")
do {
    let start = t0
    check(SessionCore.healthRestartStart(startedAt: start, now: start.addingTimeInterval(40 * 60)) == start, "a restart 40 min in covers the whole session")
    let late = start.addingTimeInterval(14 * 3600)
    check(SessionCore.healthRestartStart(startedAt: start, now: late) == late, "a session 14 h old restarts at now — never a 14-hour workout in Health")
}

print("Watch core — upgrade path (build 13 files)")
do {
    let b13Session = """
    {"clientSaveId":"x","day":"A","rpeCap":3,"startedAt":800000000,"currentIndex":1,
     "slots":[{"exerciseId":"lp","exerciseName":"Leg Press","machine":"m","setNumber":1,"setsTotal":3,"repsMin":12,"repsMax":15,"unit":"reps","restSec":120,"pinKg":2.5,"weightKg":36,"reps":12},
              {"exerciseId":"lp","exerciseName":"Leg Press","machine":"m","setNumber":2,"setsTotal":3,"repsMin":12,"repsMax":15,"unit":"reps","restSec":120,"pinKg":2.5,"weightKg":36,"reps":12}],
     "logged":[{"exerciseId":"lp","setNumber":1,"reps":12,"weight":36,"isWarmup":false}],"planOrder":["lp"]}
    """
    let decoded = try? JSONDecoder().decode(ActiveSession.self, from: Data(b13Session.utf8))
    check(decoded != nil, "a session saved by build 13 still loads — the upgrade never kills a session in progress")
    check(decoded?.slots.first?.crownStep == 0.5, "an old slot with no crown step moves 0.5 kg")
    let b13Plan = """
    {"day":"A","mode":"train","focus":"Day A","durationMin":45,"loadPct":85,"rpeCap":3,
     "exercises":[{"exerciseId":"lp","name":"Leg Press","machine":"m","order":0,"sets":3,"repsMin":12,"repsMax":15,"unit":"reps","restSec":120,"prefillKg":36,"prefillReps":12,"pinKg":2.5}]}
    """
    check((try? JSONDecoder().decode(Plan.self, from: Data(b13Plan.utf8))) != nil, "a plan without the new keys still decodes")
    let payload = """
    [{"day":"A","name":"n","startISO":"2026-09-24T17:00:00Z","localDay":"2026-09-24","durationSec":60,"gym":"bfit","healthWorkoutUuid":null,"clientSaveId":"c",
      "sets":[{"exerciseId":"lp","setNumber":1,"reps":12,"weight":36,"isWarmup":false}]}]
    """
    check((try? JSONDecoder().decode([LogPayload].self, from: Data(payload.utf8))) != nil, "a banked outbox from build 13 still decodes")
}

print("\n\(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
