import Foundation

// Mirrors of docs/WATCH.md's server contract, field for field.

struct Plan: Codable, Equatable {
    let day: String
    let mode: String
    let focus: String
    let durationMin: Int
    let loadPct: Int
    let rpeCap: Int
    let exercises: [PlanExercise]
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

    var id: String { exerciseId }
}

struct LogSet: Codable, Equatable {
    let exerciseId: String
    let setNumber: Int
    let reps: Int
    let weight: Double
    var rpe: Int?
    let isWarmup: Bool
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
    let setNumber: Int
    let setsTotal: Int
    let repsMin: Int
    let repsMax: Int
    let unit: String
    let restSec: Int
    let pinKg: Double
    var weightKg: Double // 0 = no history ("— kg" until nudged)
    var reps: Int

    var isSeconds: Bool { unit == "seconds" }

    var id: String { "\(exerciseId)-\(setNumber)" }
    var isLastOfExercise: Bool { setNumber == setsTotal }
}

/// The whole in-flight session, written to disk after every mutation so a
/// dead process loses nothing (docs/WATCH.md offline rules).
/// Cache wrapper so a stale plan can be refused: a cached plan old enough
/// to span a layoff must never start a session at full pre-break weights
/// (trainer review — the ramp is not skippable offline).
struct CachedPlan: Codable {
    let plan: Plan
    let fetchedAt: Date
}

struct ActiveSession: Codable, Equatable {
    let clientSaveId: String
    let day: String
    let rpeCap: Int
    let startedAt: Date
    var slots: [SetSlot]
    var currentIndex: Int
    var logged: [LogSet]
}
