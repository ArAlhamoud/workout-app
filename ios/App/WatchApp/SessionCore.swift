import Foundation

/// The session's pure mutations — no WatchKit, no disk, no network — so
/// scripts/watch-core-tests compiles them with swiftc on the Mac and checks
/// every rule the set card depends on. SessionStore keeps the haptics, the
/// timers, persistence and the server; everything that decides WHAT the
/// session looks like after a tap lives here.
///
/// The invariant every function keeps: `slots[..<currentIndex]` are the
/// logged slots (the head), `slots[currentIndex...]` the pending ones (the
/// tail). Rest, rating and undo read the head; the card reads the tail.
enum SessionCore {
    static let maxKg = 500.0
    static let secondsRange = 5...180

    // MARK: - Build

    /// Slots for a plan, in plan order: a warm-up slot (setNumber 0) on every
    /// weighted machine that has a warm-up weight, then its working sets.
    /// Whether a warm-up is actually DUE is decided as the session runs
    /// (retireWarmups) — the first `warmupFirstN` weighted machines he starts
    /// keep theirs, whatever they are (trainer ruling 5).
    static func buildSlots(_ p: Plan) -> [SetSlot] {
        p.exercises.sorted { $0.order < $1.order }.flatMap { ex -> [SetSlot] in
            let total = max(1, ex.sets)
            func slot(_ n: Int, weight: Double, reps: Int) -> SetSlot {
                SetSlot(
                    exerciseId: ex.exerciseId, exerciseName: ex.name, machine: ex.machine,
                    setNumber: n, setsTotal: total, repsMin: ex.repsMin, repsMax: ex.repsMax,
                    unit: ex.unit, restSec: ex.restSec ?? 90, pinKg: ex.pinKg,
                    weightKg: weight, reps: reps,
                    crownStepKg: ex.crownStepKg, alwaysWarm: ex.alwaysWarm,
                    reason: ex.reason, extraSetAllowed: ex.extraSetAllowed
                )
            }
            var out: [SetSlot] = []
            if ex.unit != "seconds", let w = ex.warmupKg, w > 0 {
                out.append(slot(0, weight: w, reps: ex.repsMin))
            }
            out += (1...total).map { slot($0, weight: ex.prefillKg ?? 0, reps: ex.prefillReps) }
            return out
        }
    }

    /// Today's machines in plan order, de-duplicated, first appearance wins.
    static func planOrder(_ slots: [SetSlot]) -> [String] {
        var seen = Set<String>()
        return slots.compactMap { seen.insert($0.exerciseId).inserted ? $0.exerciseId : nil }
    }

    // MARK: - Warm-ups

    /// Drop the pending warm-ups that are no longer due: a machine that
    /// already has a logged set (here or on the phone), and — once
    /// `warmupFirstN` weighted machines are started — every other machine
    /// except an alwaysWarm one (Back Extension). Never touches the head.
    static func retireWarmups(_ s: inout ActiveSession) {
        let n = s.warmupFirstN ?? 2
        let seconds = Set(s.slots.filter(\.isSeconds).map(\.exerciseId))
        let started = Set(s.logged.map(\.exerciseId))
        let startedWeighted = started.subtracting(seconds).count
        let head = Array(s.slots[..<s.currentIndex])
        var retired = s.retiredWarmups ?? []
        let tail = s.slots[s.currentIndex...].filter { slot in
            guard slot.isWarmup else { return true }
            if started.contains(slot.exerciseId) { return false }
            if slot.alwaysWarm == true { return true }
            if startedWeighted < n { return true }
            retired.append(slot)
            return false
        }
        s.slots = head + tail
        s.retiredWarmups = retired.isEmpty ? nil : retired
    }

    /// After an undo: a warm-up retired because "two machines were started"
    /// comes back when that is no longer true — the machine he actually
    /// starts second must still get one (review F4). One he skipped himself
    /// was never retired, so it never returns.
    static func reviveWarmups(_ s: inout ActiveSession) {
        guard var retired = s.retiredWarmups, !retired.isEmpty else { return }
        let n = s.warmupFirstN ?? 2
        let seconds = Set(s.slots.filter(\.isSeconds).map(\.exerciseId))
        let started = Set(s.logged.map(\.exerciseId))
        let startedWeighted = started.subtracting(seconds).count
        retired.removeAll { w in
            guard !started.contains(w.exerciseId), w.alwaysWarm == true || startedWeighted < n,
                  !s.slots[s.currentIndex...].contains(where: { $0.exerciseId == w.exerciseId && $0.isWarmup }),
                  let i = s.slots[s.currentIndex...].firstIndex(where: { $0.exerciseId == w.exerciseId }) else { return false }
            s.slots.insert(w, at: i)
            return true
        }
        s.retiredWarmups = retired.isEmpty ? nil : retired
    }

    // MARK: - Logging

    /// Log the current slot at `now`. A working set carries its weight AND
    /// reps forward to the machine's later pending working sets (B5: he
    /// re-dialled reps on every set); a warm-up carries nothing — copying it
    /// would open every working set at the warm-up weight.
    @discardableResult
    static func log(_ s: inout ActiveSession, now: Date) -> LogSet? {
        guard s.currentIndex < s.slots.count else { return nil }
        let slot = s.slots[s.currentIndex]
        let set = LogSet(
            exerciseId: slot.exerciseId, setNumber: slot.setNumber,
            reps: slot.reps, weight: slot.weightKg, rpe: nil, isWarmup: slot.isWarmup,
            completedAt: ISO8601DateFormatter.fractional.string(from: now)
        )
        s.logged.append(set)
        if !slot.isWarmup {
            for i in (s.currentIndex + 1)..<s.slots.count
            where s.slots[i].exerciseId == slot.exerciseId && !s.slots[i].isWarmup && s.slots[i].setNumber > slot.setNumber {
                s.slots[i].weightKg = slot.weightKg
                s.slots[i].reps = slot.reps
            }
        }
        s.currentIndex += 1
        s.extraSetOffer = nil
        retireWarmups(&s)
        return set
    }

    /// One honest rating on OUR last working set of the machine — never a
    /// warm-up, never a set the phone logged. Returns the rated set.
    static func rate(_ s: inout ActiveSession, exerciseId: String, rpe: Int) -> LogSet? {
        guard let i = s.logged.lastIndex(where: { $0.exerciseId == exerciseId && $0.origin != "phone" && !$0.isWarmup }) else { return nil }
        s.logged[i].rpe = rpe
        return s.logged[i]
    }

    /// Take back the last set THIS wrist logged: its LogSet goes, its slot
    /// returns to the front of the queue at the weight and reps it was
    /// logged with, and the card asks for it again. A rating leaves with it.
    @discardableResult
    static func undoLast(_ s: inout ActiveSession) -> LogSet? {
        guard let li = s.logged.lastIndex(where: { $0.origin != "phone" }) else { return nil }
        let set = s.logged[li]
        guard let hi = s.slots[..<s.currentIndex].lastIndex(where: { $0.exerciseId == set.exerciseId && $0.setNumber == set.setNumber }) else { return nil }
        s.logged.remove(at: li)
        var slot = s.slots.remove(at: hi)
        slot.weightKg = set.weight
        slot.reps = set.reps
        s.currentIndex -= 1
        s.slots.insert(slot, at: s.currentIndex)
        s.extraSetOffer = nil
        reviveWarmups(&s)
        return set
    }

    /// "skip warm-up": the current warm-up leaves the queue, nothing logged.
    @discardableResult
    static func skipWarmup(_ s: inout ActiveSession) -> Bool {
        guard s.currentIndex < s.slots.count, s.slots[s.currentIndex].isWarmup else { return false }
        s.slots.remove(at: s.currentIndex)
        return true
    }

    /// The last logged set this wrist could take back, if any.
    static func undoable(_ s: ActiveSession) -> LogSet? {
        s.logged.last(where: { $0.origin != "phone" })
    }

    /// '+1 set' (trainer ruling 2): one more working set on this machine,
    /// next in the queue, at the last logged weight and reps. Once per
    /// machine, at most 20 sets. Every slot of the machine learns the new
    /// total, so the rating strip follows the new last set.
    @discardableResult
    static func addSet(_ s: inout ActiveSession, exerciseId: String) -> Bool {
        guard !(s.extraSetsTaken ?? []).contains(exerciseId) else { return false }
        let mine = s.slots.filter { $0.exerciseId == exerciseId && !$0.isWarmup }
        guard var slot = mine.max(by: { $0.setNumber < $1.setNumber }), slot.setNumber < 20 else { return false }
        let n = slot.setNumber + 1
        for i in s.slots.indices where s.slots[i].exerciseId == exerciseId { s.slots[i].setsTotal = n }
        slot.setNumber = n
        slot.setsTotal = n
        if let last = s.logged.last(where: { $0.exerciseId == exerciseId && !$0.isWarmup }) {
            slot.weightKg = last.weight
            slot.reps = last.reps
        }
        s.slots.insert(slot, at: s.currentIndex)
        s.extraSetsTaken = (s.extraSetsTaken ?? []) + [exerciseId]
        s.extraSetOffer = nil
        return true
    }

    // MARK: - Occupied machine

    /// Rotate the pending machine groups; the head never moves.
    @discardableResult
    static func rotate(_ s: inout ActiveSession, forward: Bool) -> Bool {
        guard s.currentIndex < s.slots.count else { return false }
        let head = Array(s.slots[..<s.currentIndex])
        var groups: [[SetSlot]] = []
        for slot in s.slots[s.currentIndex...] {
            if let first = groups.last?.first, first.exerciseId == slot.exerciseId {
                groups[groups.count - 1].append(slot)
            } else {
                groups.append([slot])
            }
        }
        guard groups.count > 1 else { return false }
        if forward { groups.append(groups.removeFirst()) } else { groups.insert(groups.removeLast(), at: 0) }
        s.slots = head + groups.flatMap { $0 }
        return true
    }

    // MARK: - Phone ↔ wrist

    /// Phone-origin sets no longer on the row (un-ticked there) — or all of
    /// them after a phone discard — leave `logged`.
    static func dropPhoneSets(_ s: inout ActiveSession, all: Bool, keeping row: LiveSession? = nil) {
        let onRow = Set((row?.sets ?? []).map { "\($0.exerciseId)#\($0.setNumber)" })
        s.logged.removeAll { $0.origin == "phone" && (all || !onRow.contains("\($0.exerciseId)#\($0.setNumber)")) }
    }

    /// Sets the phone logged that this wrist has not seen: their slots move
    /// to the head as logged. A machine the phone started loses its pending
    /// warm-up (retireWarmups) — the wrist must not ask for one mid-machine.
    static func merge(_ s: inout ActiveSession, row: LiveSession) {
        dropPhoneSets(&s, all: false, keeping: row)
        let known = Set(s.logged.map { "\($0.exerciseId)#\($0.setNumber)" })
        let fresh = row.sets.filter { $0.source != "watch" && !known.contains("\($0.exerciseId)#\($0.setNumber)") }
        if !fresh.isEmpty {
            var head = Array(s.slots[..<s.currentIndex])
            var tail = Array(s.slots[s.currentIndex...])
            for ls in fresh {
                guard let i = tail.firstIndex(where: { $0.exerciseId == ls.exerciseId && $0.setNumber == ls.setNumber }) else { continue }
                var slot = tail.remove(at: i)
                slot.weightKg = ls.weight
                slot.reps = ls.reps
                head.append(slot)
                s.logged.append(LogSet(
                    exerciseId: ls.exerciseId, setNumber: ls.setNumber, reps: ls.reps, weight: ls.weight,
                    rpe: ls.rpe, isWarmup: ls.isWarmup ?? (ls.setNumber == 0), origin: "phone", completedAt: ls.completedAt
                ))
            }
            s.slots = head + tail
            s.currentIndex = head.count
        }
        retireWarmups(&s)
    }

    // MARK: - The card's controls

    /// One crown move of `detents`, RELATIVE to the current weight: the
    /// ladder runs through whatever the weight is (the prefill, a carried
    /// weight, his own last turn), never a grid counted from 0 — that grid
    /// is what pulled him back to "the current number". A move past 0 or
    /// 500 kg is a wall: the weight stays, so the ladder is never lost.
    static func nudgedWeight(_ slot: SetSlot, detents: Int) -> Double {
        let raw = ((slot.weightKg + Double(detents) * slot.crownStep) * 100).rounded() / 100
        return (raw < 0 || raw > maxKg) ? slot.weightKg : raw
    }

    /// The plank card: one detent = one second, walls at 5 and 180.
    static func nudgedSeconds(_ slot: SetSlot, detents: Int) -> Int {
        let next = slot.reps + detents
        return secondsRange.contains(next) ? next : slot.reps
    }

    /// Tap on reps: +1, wrapping from repsMax back to repsMin. From below
    /// repsMin (a short set carried forward) it climbs back toward it.
    static func cycledReps(_ slot: SetSlot) -> Int {
        slot.reps >= slot.repsMax ? slot.repsMin : slot.reps + 1
    }

    /// Long-press on reps: one fewer, down to 1 — a short set is a real
    /// event and must be recordable (trainer ruling 6).
    static func decrementedReps(_ slot: SetSlot) -> Int { max(1, slot.reps - 1) }

    // MARK: - Rest

    /// The countdown's range. `Date()...until` traps once `until` has passed
    /// and the view re-renders before the timer fires.
    static func restRange(now: Date, until: Date) -> ClosedRange<Date> { now...max(now, until) }

    /// A warm-up is followed by a short rest, not the machine's full one.
    static func restSeconds(after slot: SetSlot) -> Int { slot.isWarmup ? min(slot.restSec, 60) : slot.restSec }

    // MARK: - Spoken lines (the Siri lane)

    /// "36 kilos", "8.75 kilos" — the card's number, never recomputed (rule 9).
    static func spokenKg(_ kg: Double) -> String {
        let t = String(format: "%.2f", kg).replacingOccurrences(of: "\\.?0+$", with: "", options: .regularExpression)
        return "\(t) kilos"
    }

    /// What the card asks for, as Siri would say it.
    static func cardLine(_ slot: SetSlot) -> String {
        if slot.isSeconds { return "\(slot.exerciseName), set \(slot.setNumber) of \(slot.setsTotal). Hold \(slot.reps) seconds." }
        let what = slot.isWarmup ? "warm-up" : "set \(slot.setNumber) of \(slot.setsTotal)"
        let weight = slot.weightKg > 0 ? spokenKg(slot.weightKg) : "bodyweight"
        return "\(slot.exerciseName), \(what). \(weight), \(slot.reps) reps."
    }

    /// The reply to a spoken "done": what was logged, the rest, what is next.
    static func loggedLine(_ set: LogSet, restSeconds: Int?, next: SetSlot?) -> String {
        var parts: [String] = []
        if set.weight > 0 {
            parts.append("Logged \(spokenKg(set.weight)) by \(set.reps).")
        } else {
            parts.append("Logged \(set.reps).")
        }
        if let r = restSeconds { parts.append("Rest \(r) seconds.") }
        if let next { parts.append("Next: \(cardLine(next))") } else { parts.append("That was the last set. Finish on the watch.") }
        return parts.joined(separator: " ")
    }

    // MARK: - HealthKit restarts

    /// Where a restarted HealthKit workout begins: the session's start while
    /// that is within 3 h (a crash or another app ending ours mid-session),
    /// else now. Apple Health writes cannot be undone, and an unbounded
    /// backdate wrote a 14-hour workout for a session relaunched next day
    /// (rule 11; the phone's own write caps a session at 3 h too).
    static let healthRestartWindow: TimeInterval = 3 * 3600
    static func healthRestartStart(startedAt: Date, now: Date) -> Date {
        now.timeIntervalSince(startedAt) <= healthRestartWindow ? startedAt : now
    }

    // MARK: - Offline start

    /// May a CACHED plan start a session now? Within 7 days of the fetch,
    /// and never past the server's startableUntil — the day a layoff would
    /// trigger the return ramp, after which its weights are full-load.
    static func planStartable(_ p: Plan, fetchedAt: Date, now: Date) -> Bool {
        guard now.timeIntervalSince(fetchedAt) < 7 * 86400 else { return false }
        if let raw = p.startableUntil, let until = ISO8601DateFormatter.fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) {
            return now < until
        }
        return true
    }

    // MARK: - Machine position

    /// "2/6": the current machine's place in TODAY'S PLAN (never the queue).
    static func machinePosition(_ s: ActiveSession) -> (index: Int, total: Int)? {
        guard s.currentIndex < s.slots.count, let order = s.planOrder, order.count > 1,
              let i = order.firstIndex(of: s.slots[s.currentIndex].exerciseId) else { return nil }
        return (i + 1, order.count)
    }
}

/// Live-row updates, sent ONE post at a time and acknowledged in order.
/// Concurrent posts could land out of order on the server (which merges
/// without a lock and lets a tie win), and acking by count could drop an
/// update still in flight — a rating or an undo lost from the row with
/// nothing left to resend (review F1). Only the in-flight prefix is ever
/// removed, and only after its post came back.
struct LiveQueue: Equatable {
    private(set) var pending: [LiveUpdate] = []
    /// nil = idle; n = a post carrying the first n entries is out (0 for the
    /// session-opening post, which carries none but is in flight all the same).
    private var inFlight: Int? = nil

    init(_ pending: [LiveUpdate] = []) { self.pending = pending }

    mutating func append(_ updates: [LiveUpdate]) { pending += updates }

    /// The next post's body — everything queued — or nil while one is out.
    /// `allowEmpty`: the opening post goes out with no sets, tracked like any
    /// other (untracked, its ack cleared a real post's flag — final review).
    mutating func nextBatch(allowEmpty: Bool = false) -> [LiveUpdate]? {
        guard inFlight == nil, !pending.isEmpty || allowEmpty else { return nil }
        inFlight = pending.count
        return pending
    }

    /// That post came back: its prefix leaves the queue.
    mutating func ack(_ count: Int) {
        pending.removeFirst(min(count, pending.count))
        inFlight = nil
    }

    /// It failed: everything stays for the next try.
    mutating func fail() { inFlight = nil }

    var isSending: Bool { inFlight != nil }
}
