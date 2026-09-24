import Foundation

// Mirrors of docs/WATCH.md's server contract, field for field.
//
// EVERY field added after build 13 is optional. A build upgrade lands in the
// middle of a session more often than not (TestFlight installs overnight),
// and synthesised Codable throws on a missing non-optional key — loadSession()
// would return nil and the session in progress would silently vanish.

struct Plan: Codable, Equatable {
    let day: String
    let mode: String
    let focus: String
    let durationMin: Int
    let loadPct: Int
    let rpeCap: Int
    let exercises: [PlanExercise]
    /// How many weighted machines he STARTS get a warm-up set (trainer
    /// ruling 5). nil on plans from before it existed: 2.
    let warmupFirstN: Int?
    /// The latest moment this plan may START a session offline: the day a
    /// layoff would trigger the return ramp. Past it, a cached plan's
    /// full-load weights could be a comeback at 100% (trainer review).
    let startableUntil: String?
}

struct PlanExercise: Codable, Equatable, Identifiable {
    let exerciseId: String
    let name: String
    let machine: String
    let order: Int
    let sets: Int
    let repsMin: Int
    let repsMax: Int
    let unit: String // "reps" | "seconds"
    let restSec: Int?
    let prefillKg: Double?
    let prefillReps: Int
    let pinKg: Double
    /// What ONE crown detent moves: his own step once he has set it, else 0.5.
    let crownStepKg: Double?
    /// This machine's warm-up weight, sent for every weighted machine; the
    /// wrist decides whether it is due (warmupFirstN / alwaysWarm).
    let warmupKg: Double?
    let alwaysWarm: Bool?
    /// Why prefillKg is what it is: none|timed|last|ramp|held|overload|deload|short|reps.
    let reason: String?
    let fromKg: Double?
    let note: String?
    /// '+1 set' may be offered after a below-cap rating (never REBOOT/REBUILD).
    let extraSetAllowed: Bool?

    var id: String { exerciseId }
}

struct LogSet: Codable, Equatable {
    let exerciseId: String
    let setNumber: Int
    let reps: Int
    let weight: Double
    var rpe: Int?
    let isWarmup: Bool
    /// "phone" when the set arrived through the live row rather than this
    /// wrist — never rated here, dropped if the phone un-ticks or discards.
    var origin: String? = nil
    /// The instant the set was logged. Rides the live row and the finish,
    /// so a removal the phone recorded earlier never beats it — and a
    /// rating added later keeps this stamp, not the moment of the tap.
    var completedAt: String? = nil
}

struct LogPayload: Codable, Equatable {
    let day: String
    let name: String
    let startISO: String
    /// The session's LOCAL calendar day (yyyy-MM-dd). Required in practice:
    /// without it the server dates the workout by UTC instant, and an
    /// after-midnight Riyadh session lands on the wrong day.
    let localDay: String
    let durationSec: Int
    let gym: String
    let healthWorkoutUuid: String?
    let clientSaveId: String
    var sets: [LogSet]
}

struct LogResponse: Codable {
    let id: String?
    let deduped: Bool?
    let error: String?
}

/// One position in the flattened session: exercise × set number, with the
/// weight the crown adjusts. Everything needed to render a set card.
struct SetSlot: Codable, Equatable, Identifiable {
    let exerciseId: String
    let exerciseName: String
    let machine: String
    /// 0 = the warm-up (the server's convention too); working sets 1…n.
    var setNumber: Int
    /// Grows by one when he takes '+1 set', on every slot of that machine,
    /// so the rating strip follows the NEW last set.
    var setsTotal: Int
    let repsMin: Int
    let repsMax: Int
    let unit: String
    let restSec: Int
    let pinKg: Double
    var weightKg: Double // 0 = no history ("— kg" until nudged)
    var reps: Int
    var crownStepKg: Double? = nil
    var alwaysWarm: Bool? = nil
    var reason: String? = nil
    var extraSetAllowed: Bool? = nil

    var isSeconds: Bool { unit == "seconds" }
    var isWarmup: Bool { setNumber == 0 }

    var id: String { "\(exerciseId)-\(setNumber)" }
    var isLastOfExercise: Bool { !isWarmup && setNumber == setsTotal }
    /// One crown detent. An unconfirmed machine moves 0.5 kg so any weight
    /// he really lifted is reachable (trainer ruling 4).
    var crownStep: Double { (crownStepKg ?? 0) > 0 ? crownStepKg! : 0.5 }
}

/// The whole in-flight session, written to disk after every mutation so a
/// dead process loses nothing (docs/WATCH.md offline rules).
/// Cache wrapper so a stale plan can be refused: a cached plan old enough
/// to span a layoff must never start a session at full pre-break weights
/// (trainer review — the ramp is not skippable offline).
struct CachedPlan: Codable {
    let plan: Plan
    let fetchedAt: Date
    /// The building it was fetched for — a B_Fit plan must never start an
    /// Alrajhi session offline (rule 2). nil = before it was recorded: B_Fit.
    var gym: String? = nil
}

struct ActiveSession: Codable, Equatable {
    let clientSaveId: String
    let day: String
    let rpeCap: Int
    let startedAt: Date
    var slots: [SetSlot]
    var currentIndex: Int
    var logged: [LogSet]
    /// The building the OPENING device tagged (rule 2). nil = this wrist
    /// opened it; the server defaults to B_Fit.
    var gym: String? = nil
    /// Today's machines in PLAN order, captured once when the session opens.
    /// The card numbers a machine by its place HERE ("2/6"), never by its
    /// place in the queue: a rotation moves the current machine to the back,
    /// so queue position would still read 1/6 straight after a swipe — the
    /// opposite of what the number is for. Optional so sessions persisted
    /// before 2026-09-12 still decode (synthesised Codable throws on a
    /// missing key unless the property is optional; `gym` is optional for
    /// the same reason).
    var planOrder: [String]? = nil
    /// The plan's load (100 outside a ramp): the strip says "Ramp target"
    /// only below 100, "Ceiling" otherwise.
    var loadPct: Int? = nil
    /// The session's own length, for the live row (not whichever plan was
    /// fetched last).
    var durationMin: Int? = nil
    var warmupFirstN: Int? = nil
    /// Live-row updates not yet acknowledged; every post resends them. An
    /// undo whose removal never arrived would otherwise come back when the
    /// phone finishes first.
    var unsentLive: [LiveUpdate]? = nil
    /// The rest in progress, so a relaunch resumes the countdown instead of
    /// dropping onto the set card.
    var restUntil: Date? = nil
    /// Machines that already took their '+1 set' (once per machine).
    var extraSetsTaken: [String]? = nil
    /// The machine whose '+1 set' is on offer right now (after a below-cap
    /// rating), cleared by the next log.
    var extraSetOffer: String? = nil
    /// Warm-ups retired because enough machines were started — kept so an
    /// undo can bring back the ones that are due again.
    var retiredWarmups: [SetSlot]? = nil
    /// The HKWorkout this session already saved (end() ran). Kept so a
    /// session that survives its own finish (a failed save, a killed
    /// process) never starts a second workout on top of it, and the finish
    /// still carries the uuid (rule 11).
    var hkWorkoutUuid: String? = nil
    var hkEnded: Bool? = nil
}

// MARK: - Live session (phone ↔ watch handoff, docs/WATCH.md "Live session")

struct LiveSet: Codable, Equatable {
    let exerciseId: String
    let setNumber: Int
    let reps: Int
    let weight: Double
    var rpe: Int?
    var isWarmup: Bool?
    let completedAt: String
    let source: String
}

struct LiveSession: Codable, Equatable {
    let clientSaveId: String
    let day: String?
    let durationMin: Int?
    let gym: String?
    let source: String
    let startedAt: String
    let updatedAt: String
    let closedAt: String?
    let workoutId: String?
    let sets: [LiveSet]

    var isClosed: Bool { closedAt != nil }
    var startedDate: Date { ISO8601DateFormatter.fractional.date(from: startedAt) ?? Date() }
    var updatedDate: Date { ISO8601DateFormatter.fractional.date(from: updatedAt) ?? .distantPast }
}

struct LiveEnvelope: Codable { let live: LiveSession? }

/// One outbound update: a logged set, or an un-log.
struct LiveUpdate: Codable, Equatable {
    let exerciseId: String
    let setNumber: Int
    var reps: Int?
    var weight: Double?
    var rpe: Int?
    var isWarmup: Bool?
    var completedAt: String?
    var remove: Bool?
}

struct LivePost: Codable {
    let clientSaveId: String
    let source: String
    var day: String?
    var durationMin: Int?
    var gym: String?
    var startedAt: String?
    var sets: [LiveUpdate]
}

extension ISO8601DateFormatter {
    /// The server writes fractional seconds; a plain formatter rejects them.
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
