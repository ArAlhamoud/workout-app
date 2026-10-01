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
        // The machine's last set puts its rating strip up; remembered on the
        // session so a kill during the strip comes back to it (restorePoint).
        s.pendingRpe = slot.isLastOfExercise ? slot.exerciseId : nil
        retireWarmups(&s)
        return set
    }

    /// One honest rating on OUR last working set of the machine — never a
    /// warm-up, never a set the phone logged. Returns the rated set.
    static func rate(_ s: inout ActiveSession, exerciseId: String, rpe: Int, now: Date = Date()) -> LogSet? {
        if s.pendingRpe == exerciseId { s.pendingRpe = nil }
        guard let i = s.logged.lastIndex(where: { $0.exerciseId == exerciseId && $0.origin != "phone" && !$0.isWarmup }) else { return nil }
        s.logged[i].rpe = rpe
        // Edited NOW, ticked THEN: the server orders two versions of one
        // tick by this stamp. Dated by the tick alone, a wrist rating given
        // after a phone correction was judged the older version.
        s.logged[i].editedAt = ISO8601DateFormatter.fractional.string(from: now)
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
        s.pendingRpe = nil
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
    /// them after a phone discard — leave `logged`, AND their slots go back
    /// to the pending queue. The log used to go alone: the slot stayed in
    /// the head as if done, so the card was never offered again and a
    /// re-tick on the phone found no pending slot to land on (review
    /// 2026-10). The slot returns among its machine's pending sets, in set
    /// order, at their weight (the phone's number was un-ticked with the
    /// set); with none pending it waits at the back of the queue — an
    /// un-tick never changes the card of ANOTHER machine under his hand.
    static func dropPhoneSets(_ s: inout ActiveSession, all: Bool, keeping row: LiveSession? = nil) {
        let onRow = Set((row?.sets ?? []).map { "\($0.exerciseId)#\($0.setNumber)" })
        let gone = s.logged.filter { $0.origin == "phone" && (all || !onRow.contains("\($0.exerciseId)#\($0.setNumber)")) }
        guard !gone.isEmpty else { return }
        s.logged.removeAll { $0.origin == "phone" && (all || !onRow.contains("\($0.exerciseId)#\($0.setNumber)")) }
        for set in gone {
            guard let hi = s.slots[..<s.currentIndex].lastIndex(where: { $0.exerciseId == set.exerciseId && $0.setNumber == set.setNumber }) else { continue }
            var slot = s.slots.remove(at: hi)
            s.currentIndex -= 1
            let tail = s.slots[s.currentIndex...]
            if !slot.isWarmup, let sibling = tail.first(where: { $0.exerciseId == slot.exerciseId && !$0.isWarmup }) {
                slot.weightKg = sibling.weightKg
                slot.reps = sibling.reps
            }
            let at = tail.firstIndex(where: { $0.exerciseId == slot.exerciseId && $0.setNumber > slot.setNumber })
                ?? tail.lastIndex(where: { $0.exerciseId == slot.exerciseId }).map { $0 + 1 }
                ?? s.slots.count
            s.slots.insert(slot, at: at)
        }
        reviveWarmups(&s)
    }

    /// The row's phone sets, on every read. One this wrist has not seen: its
    /// slot moves to the head as logged. One it already copied: the copy
    /// TRACKS the row — it was copied once and never looked at again, so a
    /// phone correction (20 kg unrated → 22.5 Hard) never reached the wrist,
    /// whose finish then posted the stale copy, and the server lets the
    /// poster win (review 2026-10). A set logged on the wrist is the wrist's
    /// and is never rewritten from the row; the wrist cannot edit a phone
    /// set (no rating, no undo), so origin "phone" means untouched here.
    /// A machine the phone started loses its pending warm-up (retireWarmups)
    /// — the wrist must not ask for one mid-machine.
    static func merge(_ s: inout ActiveSession, row: LiveSession) {
        dropPhoneSets(&s, all: false, keeping: row)
        let theirs = row.sets.filter { $0.source != "watch" }
        for ls in theirs {
            guard let i = s.logged.firstIndex(where: { $0.exerciseId == ls.exerciseId && $0.setNumber == ls.setNumber }) else { continue }
            let mine = s.logged[i]
            let latest: LogSet
            if mine.origin == "phone" {
                latest = LogSet(
                    exerciseId: ls.exerciseId, setNumber: ls.setNumber, reps: ls.reps, weight: ls.weight,
                    rpe: ls.rpe, isWarmup: mine.isWarmup, origin: "phone", completedAt: ls.completedAt
                )
            } else {
                // A set the WRIST logged, which the phone has since edited
                // (the row's version is the phone's and is the later one).
                // Adopted, or the wrist's next rating — stamped "now" — would
                // carry its own stale weight over the correction. It stays
                // the wrist's to rate; like the server, no rating never
                // erases a rating at the same weight × reps. An older or
                // undated row version changes nothing.
                guard let theirsAt = stamp(ls.editedAt ?? ls.completedAt),
                      let mineAt = stamp(mine.editedAt ?? mine.completedAt), theirsAt > mineAt else { continue }
                let sameLoad = ls.weight == mine.weight && ls.reps == mine.reps
                latest = LogSet(
                    exerciseId: mine.exerciseId, setNumber: mine.setNumber, reps: ls.reps, weight: ls.weight,
                    rpe: ls.rpe ?? (sameLoad ? mine.rpe : nil), isWarmup: mine.isWarmup, origin: mine.origin,
                    completedAt: ls.completedAt, editedAt: ls.editedAt
                )
            }
            guard latest != mine else { continue }
            s.logged[i] = latest
            if let h = s.slots[..<s.currentIndex].lastIndex(where: { $0.exerciseId == ls.exerciseId && $0.setNumber == ls.setNumber }) {
                s.slots[h].weightKg = ls.weight
                s.slots[h].reps = ls.reps
            }
        }
        let known = Set(s.logged.map { "\($0.exerciseId)#\($0.setNumber)" })
        let fresh = theirs.filter { !known.contains("\($0.exerciseId)#\($0.setNumber)") }
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

    /// A server or wrist time stamp, with or without fractional seconds.
    static func stamp(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        return ISO8601DateFormatter.fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }

    /// One logged set as a live-row update. completedAt is the set's OWN
    /// time — a rating re-posted later keeps it, so a phone removal made in
    /// between still wins (live-session.ts tombstones) — and editedAt rides
    /// along only when this wrist changed the set after the tick.
    static func liveUpdate(_ set: LogSet, now: Date) -> LiveUpdate {
        LiveUpdate(
            exerciseId: set.exerciseId, setNumber: set.setNumber, reps: set.reps, weight: set.weight,
            rpe: set.rpe, isWarmup: set.isWarmup,
            completedAt: set.completedAt ?? ISO8601DateFormatter.fractional.string(from: now), remove: nil,
            editedAt: set.editedAt
        )
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

    /// What a cached plan may do for a start with no signal.
    enum CacheVerdict: Equatable {
        case ok
        /// Past seven days or the server's startableUntil (planStartable).
        case tooOld
        /// Another day, another building, or not the server's queue.
        case wrongPlan
        /// Its day was already trained on this wrist: no longer the queue.
        case trained
        /// Cached by a build that did not record how it was fetched: maybe
        /// the queue, maybe the last session's own plan. Never started as
        /// the queue; offered BY NAME for one confirming tap.
        case unconfirmed
    }

    /// May this cached plan open the start that was asked for? A day he
    /// names is served by any cached plan for that day and building. A start
    /// with NO day (the Action Button, the big button as planned) means "the
    /// server's queue", and only a plan fetched that way is one — the cache
    /// used to hold whatever was fetched last, so after a session it was that
    /// session's own explicit-day or Continue plan, and an offline Action
    /// Button repeated the same day at pre-session weights (review 2026-10).
    /// Nor is a queue plan still the queue once its day was trained here:
    /// finished since the fetch (`trainedAt`), or still banked on this wrist
    /// (`bankedDays`) where the server has not seen it.
    static func cacheVerdict(_ c: CachedPlan, day: String?, gym: String?, bankedDays: [String], now: Date) -> CacheVerdict {
        guard planStartable(c.plan, fetchedAt: c.fetchedAt, now: now) else { return .tooOld }
        guard (c.gym ?? "bfit") == (gym ?? "bfit") else { return .wrongPlan }
        if let day { return c.plan.day == day ? .ok : .wrongPlan }
        guard c.queue == true else { return c.queue == nil ? .unconfirmed : .wrongPlan }
        if c.trainedAt != nil || bankedDays.contains(c.plan.day) { return .trained }
        return .ok
    }

    /// A FRESH queue plan can be stale too: the server chose its day without
    /// a session that is still banked on this wrist (the flush before a
    /// start is bounded, and a 5xx keeps a payload banked with signal up).
    /// Banked when the fetch BEGAN counts as much as banked when it came
    /// back: the flush keeps running past the start's 4 s wait, so the POST
    /// can commit after the server computed the plan and before this check
    /// — an empty outbox then proved nothing (blind review).
    static func queuePlanStale(day: String, bankedBefore: [String], bankedAfter: [String]) -> Bool {
        bankedBefore.contains(day) || bankedAfter.contains(day)
    }

    /// The owner's activity day: it rolls over at 04:00 Riyadh, so a session
    /// after midnight belongs to the evening it started in.
    static func activityDay(_ date: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(identifier: "Asia/Riyadh")
        df.dateFormat = "yyyy-MM-dd"
        return df.string(from: date.addingTimeInterval(-4 * 3600))
    }

    /// The days of the banked sessions that may still refuse a queue start:
    /// today's only. A payload the server answers 5xx for stays banked for
    /// good, and it refused every matching start for as long (blind
    /// review). From the next activity day on, the server's queue stands.
    static func bankedToday(_ payloads: [LogPayload], now: Date) -> [String] {
        let today = activityDay(now)
        return payloads.filter { stamp($0.startISO).map(activityDay) == today }.map(\.day)
    }

    /// The other day of the two-day program, to fetch and cache beside a
    /// queue plan. Without it, two sessions in a row with no signal could
    /// start NOTHING: Day A banked, its plan spent as the queue, and no plan
    /// on the wrist for Day B (blind review). This is not the wrist choosing
    /// the queue (rule 9) — it only keeps the server's plan for the day he
    /// may pick by name. B_Fit only: the wrist opens no session elsewhere.
    static func companionDay(for plan: Plan, gym: String?) -> String? {
        guard (gym ?? "bfit") == "bfit" else { return nil }
        switch plan.day {
        case "A": return "B"
        case "B": return "A"
        default: return nil
        }
    }

    /// The asked cache holds ONE plan per day and building, newest kept.
    /// As a single slot, the companion fetch and a Continue evicted each other.
    static func upsertCached(_ list: [CachedPlan], _ c: CachedPlan) -> [CachedPlan] {
        list.filter { !($0.plan.day == c.plan.day && ($0.gym ?? "bfit") == (c.gym ?? "bfit")) } + [c]
    }

    /// The cached plan that may open this start, newest first — or the most
    /// telling refusal: "already trained" over "cannot confirm the queue"
    /// over "too old" over "not the plan asked for". `why` nil = nothing cached.
    static func pickCached(_ cached: [CachedPlan], day: String?, gym: String?, bankedDays: [String], now: Date) -> (cached: CachedPlan?, why: CacheVerdict?) {
        let sorted = cached.sorted { $0.fetchedAt > $1.fetchedAt }
        let verdicts = sorted.map { cacheVerdict($0, day: day, gym: gym, bankedDays: bankedDays, now: now) }
        if let i = verdicts.firstIndex(of: .ok) { return (sorted[i], .ok) }
        return (nil, [.trained, .unconfirmed, .tooOld, .wrongPlan].first(where: verdicts.contains))
    }

    // MARK: - Start decisions

    /// Does the Action Button start at once? Only on a training day. On a
    /// recovery day, or with a session already done today, it used to start
    /// anyway with no word — the plan's advice lived only on the Start
    /// screen (trainer review). Now it lands there, advice showing, and one
    /// tap goes ahead: advice, never a block.
    static func buttonStarts(mode: String) -> Bool { mode == "train" }

    /// May the Action Button open a NEW session? Not when the plan came
    /// back but the live lookup did not: signal is there, the phone may hold
    /// an open session, and a new id's opening post would close it — two
    /// partial workouts for one visit. With no signal at all nothing can be
    /// closed, and the offline start is the point of the wrist.
    static func buttonMayOpenNew(liveKnown: Bool, planFresh: Bool) -> Bool { liveKnown || !planFresh }

    /// The big button read "Day A"; did Day A open? When the queue moved
    /// since the screen was drawn, the new day is SHOWN for a tap, never
    /// opened under the old label. nil = no day was on screen.
    static func promiseKept(shown: String?, opened: String) -> Bool { shown == nil || shown == opened }

    /// A wrist raise or a launch, in order. The live row comes FIRST: the
    /// outbox flush can wait 12 s per banked payload on a slow or captive
    /// network, and the phone's sets sat behind it. The queue plan follows
    /// the flush (which moves the queue) and is not fetched mid-session.
    enum ForegroundStep: Equatable { case flush, plan, live }
    static func foregroundSteps(sessionActive: Bool) -> [ForegroundStep] {
        sessionActive ? [.live, .flush] : [.live, .flush, .plan]
    }

    /// A session of `day` was finished here: a cached plan for that day is
    /// spent as the queue. Another day's plan is untouched.
    static func markTrained(_ c: CachedPlan, day: String, at: Date) -> CachedPlan {
        guard c.plan.day == day else { return c }
        var out = c
        out.trainedAt = at
        return out
    }

    /// The day the Start screen's big button asks the server for: the one he
    /// deliberately picked, else the cached day the wrist OFFERED by name
    /// after it could not confirm the queue, else NONE. It used to send the
    /// day the screen was showing — a plan fetched once per process — as if
    /// it were today's queue; the server obeyed an explicit day.
    static func startDay(override: String?, offered: String?) -> String? { override ?? offered }

    // MARK: - Outbox

    /// A network path update: flush when there is a path and something is
    /// banked. Every satisfied update counts, not only the first — Wi-Fi to
    /// cellular is a second chance for a send that just failed.
    static func flushOnPath(satisfied: Bool, banked: Int) -> Bool { satisfied && banked > 0 }

    // MARK: - Build label

    /// "build 13 · Sep 24": the bundle version and the day the BINARY was
    /// built. The number alone read 13 from 2026-09-12 on, across many dev
    /// installs of different code, so it could not tell two of them apart.
    static func buildLabel(version: String?, builtAt: Date?, timeZone: TimeZone = .current) -> String {
        let base = "build \(version ?? "?")"
        guard let builtAt else { return base }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = timeZone
        df.dateFormat = "MMM d"
        return "\(base) · \(df.string(from: builtAt))"
    }

    // MARK: - Relaunch

    enum RestorePoint: Equatable {
        case summary
        case resting(until: Date)
        case rating(exerciseId: String, exerciseName: String)
        case active
    }

    /// Where a session read back from disk resumes. The unanswered rating
    /// strip comes first — before the summary too, since the last machine's
    /// strip stands between its last set and the summary — then the rest
    /// still running, else the card. Only while there is still a set of ours
    /// on that machine to rate.
    static func restorePoint(_ s: ActiveSession, now: Date) -> RestorePoint {
        if let id = s.pendingRpe,
           s.logged.contains(where: { $0.exerciseId == id && $0.origin != "phone" && !$0.isWarmup && $0.rpe == nil }),
           let name = s.slots.first(where: { $0.exerciseId == id })?.exerciseName {
            return .rating(exerciseId: id, exerciseName: name)
        }
        if s.currentIndex >= s.slots.count { return .summary }
        if let u = s.restUntil, u > now { return .resting(until: u) }
        return .active
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
