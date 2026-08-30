import Foundation
import SwiftUI
import WatchKit

/// The session state machine: idle → active(set cards) → rest → RPE strip →
/// summary → done. Confirm/adjust only — the server already decided the
/// numbers. Every mutation is persisted immediately; a dead process resumes
/// exactly where the last set was logged (docs/WATCH.md offline rules).
@MainActor
final class SessionStore: ObservableObject {
    enum Phase: Equatable {
        case idle
        case loading
        case active
        case resting(until: Date)
        case rpePrompt(exerciseId: String, exerciseName: String)
        case summary
        case uploading
        case done(banked: Bool)
    }

    @Published var phase: Phase = .idle
    @Published var plan: Plan?
    @Published var session: ActiveSession?
    @Published var pendingCount: Int = Store.loadOutbox().count
    /// One-line notice on the Start screen (e.g. why a start was refused).
    @Published var notice: String?

    let workout = WorkoutManager()
    private var restTimer: Timer?

    // MARK: - Launch

    /// On launch: resume a crashed/killed session if one exists, flush any
    /// banked payloads, and warm the plan from cache then network.
    func onLaunch() {
        if let s = Store.loadSession() {
            session = s
            phase = s.currentIndex >= s.slots.count ? .summary : .active
        }
        plan = Store.loadPlanCache()
        Task {
            let sent = await Store.flushOutbox()
            if sent > 0 { pendingCount = Store.loadOutbox().count }
            await refreshPlan(day: nil, dur: nil)
        }
    }

    func refreshPlan(day: String?, dur: Int?) async {
        if let fresh = try? await API.fetchPlan(day: day, dur: dur) {
            plan = fresh
        }
    }

    // MARK: - Start

    /// Start with whatever is best available: fresh plan if the network
    /// answers fast, cached plan otherwise. The Action Button lands here.
    func start(day: String?, dur: Int?) async {
        guard session == nil else { phase = .active; return }
        phase = .loading
        notice = nil
        var p = try? await API.fetchPlan(day: day, dur: dur)
        if p == nil {
            // Offline fallback — but NEVER from a cache old enough to span a
            // layoff: a stale plan carries pre-break weights with no ramp
            // scaling and no RPE cap (trainer review, blocking). Better no
            // session start than a dangerous one; the built-in Workout app +
            // phone detect remain the fallback.
            p = Store.startablePlan()
            if p == nil, Store.loadPlanCache() != nil {
                notice = "Plan too old — need signal once"
            } else if p == nil {
                notice = "No plan yet — need signal once"
            }
        }
        guard let p, !p.exercises.isEmpty else { phase = .idle; return }
        plan = p

        let slots = p.exercises
            .sorted { $0.order < $1.order }
            .flatMap { ex in
                (1...max(1, ex.sets)).map { n in
                    SetSlot(
                        exerciseId: ex.exerciseId, exerciseName: ex.name,
                        machine: ex.machine, setNumber: n, setsTotal: max(1, ex.sets),
                        repsMin: ex.repsMin, repsMax: ex.repsMax, unit: ex.unit,
                        restSec: ex.restSec ?? 90,
                        pinKg: ex.pinKg, weightKg: ex.prefillKg ?? 0,
                        reps: ex.prefillReps
                    )
                }
            }
        let s = ActiveSession(
            clientSaveId: UUID().uuidString, day: p.day, rpeCap: p.rpeCap,
            startedAt: Date(), slots: slots, currentIndex: 0, logged: []
        )
        session = s
        Store.saveSession(s)
        await workout.requestAuthorization()
        workout.begin()
        phase = .active
    }

    // MARK: - The set flow

    var currentSlot: SetSlot? {
        guard let s = session, s.currentIndex < s.slots.count else { return nil }
        return s.slots[s.currentIndex]
    }

    func adjust(weight: Double) {
        guard var s = session, s.currentIndex < s.slots.count else { return }
        s.slots[s.currentIndex].weightKg = max(0, weight)
        session = s
        Store.saveSession(s)
    }

    /// Seconds cards (plank): the crown owns the hold time directly.
    func setSeconds(_ sec: Int) {
        guard var s = session, s.currentIndex < s.slots.count else { return }
        s.slots[s.currentIndex].reps = max(5, min(180, sec))
        session = s
        Store.saveSession(s)
    }

    /// Tap on reps cycles repsMin…repsMax (docs/WATCH.md screen 2).
    func cycleReps() {
        guard var s = session, s.currentIndex < s.slots.count else { return }
        let slot = s.slots[s.currentIndex]
        let next = slot.reps >= slot.repsMax ? slot.repsMin : slot.reps + 1
        s.slots[s.currentIndex].reps = next
        session = s
        Store.saveSession(s)
    }

    /// Reps cards refuse a 0 kg log — a phantom-zero set would poison the
    /// gym-scoped prefill memory the next plan is built from (CLAUDE.md
    /// rule 2). Seconds cards (plank) are weightless by design.
    var canLogCurrentSet: Bool {
        guard let slot = currentSlot else { return false }
        return slot.isSeconds || slot.weightKg > 0
    }

    func logCurrentSet() {
        guard canLogCurrentSet else { return }
        guard var s = session, s.currentIndex < s.slots.count else { return }
        let slot = s.slots[s.currentIndex]
        s.logged.append(LogSet(
            exerciseId: slot.exerciseId, setNumber: slot.setNumber,
            reps: slot.reps, weight: slot.weightKg, rpe: nil, isWarmup: false
        ))
        // Prefill forward: the next set of the same machine starts where
        // this one ended.
        for i in s.slots.indices where s.slots[i].exerciseId == slot.exerciseId && s.slots[i].setNumber > slot.setNumber {
            s.slots[i].weightKg = slot.weightKg
        }
        s.currentIndex += 1
        session = s
        Store.saveSession(s)
        WKInterfaceDevice.current().play(.click)

        if slot.isLastOfExercise {
            phase = .rpePrompt(exerciseId: slot.exerciseId, exerciseName: slot.exerciseName)
        } else {
            beginRest()
        }
    }

    /// RPE strip answer: one honest value on the set it describes — the
    /// last one — the rest left unrated. Cloning one tap onto every set
    /// inflated hardShare and corrupted the coach's per-set reads
    /// (trainer review).
    func setRPE(_ rpe: Int, exerciseId: String) {
        guard var s = session else { return }
        if let i = s.logged.lastIndex(where: { $0.exerciseId == exerciseId }) {
            s.logged[i].rpe = rpe
        }
        session = s
        Store.saveSession(s)
        advanceAfterExercise()
    }

    func skipRPE() { advanceAfterExercise() }

    private func advanceAfterExercise() {
        guard let s = session else { return }
        if s.currentIndex >= s.slots.count {
            phase = .summary
        } else {
            beginRest()
        }
    }

    // MARK: - Rest

    private func beginRest() {
        // Rest is programming, not a constant: 120 s after Leg Press is not
        // 45 s after core. The slot just logged carries its own prescription.
        let justLogged = session.flatMap { s in s.currentIndex > 0 ? s.slots[s.currentIndex - 1] : nil }
        let restSeconds = TimeInterval(justLogged?.restSec ?? 90)
        let until = Date().addingTimeInterval(restSeconds)
        phase = .resting(until: until)
        restTimer?.invalidate()
        restTimer = Timer.scheduledTimer(withTimeInterval: restSeconds, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, case .resting = self.phase else { return }
                WKInterfaceDevice.current().play(.notification)
                self.phase = .active
            }
        }
    }

    func skipRest() {
        restTimer?.invalidate()
        phase = .active
    }

    /// Every remaining set already logged? Land on summary from anywhere.
    func endEarly() {
        restTimer?.invalidate()
        phase = .summary
    }

    // MARK: - Finish

    func finish() async {
        guard let s = session, !s.logged.isEmpty else { discard(); return }
        phase = .uploading
        let uuid = await workout.end()
        let fmt = ISO8601DateFormatter()
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US")
        df.dateFormat = "MMM d"
        let payload = LogPayload(
            day: s.day,
            name: "Day \(s.day) — Watch · \(df.string(from: s.startedAt))",
            startISO: fmt.string(from: s.startedAt),
            durationSec: Int(Date().timeIntervalSince(s.startedAt)),
            gym: "bfit",
            healthWorkoutUuid: uuid,
            clientSaveId: s.clientSaveId,
            sets: s.logged
        )
        let sent = await API.postLog(payload)
        if !sent { Store.enqueue(payload) }
        Store.saveSession(nil)
        session = nil
        pendingCount = Store.loadOutbox().count
        phase = .done(banked: !sent)
        WKInterfaceDevice.current().play(sent ? .success : .directionUp)
    }

    /// Zero sets logged — nothing worth keeping, and no HKWorkout saved:
    /// abort() discards the recording so the phone's detect can't resurrect
    /// a session he deliberately threw away.
    func discard() {
        restTimer?.invalidate()
        workout.abort()
        Store.saveSession(nil)
        session = nil
        phase = .idle
    }

    func reset() {
        phase = .idle
        Task {
            let sent = await Store.flushOutbox()
            if sent > 0 { pendingCount = Store.loadOutbox().count }
        }
    }
}
