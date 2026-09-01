import Foundation
import HealthKit

/// Wraps the HKWorkoutSession so heart rate, rings and the always-on session
/// UI come free, and so the finished HKWorkout's uuid rides the POST as the
/// dedupe key against the phone's auto-detect (docs/WATCH.md). Every path is
/// graceful: HealthKit denied or failing never blocks logging — the uuid is
/// simply nil and the clientSaveId dedupe still holds.
final class WorkoutManager: NSObject, ObservableObject {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let share: Set<HKSampleType> = [HKObjectType.workoutType()]
        let read: Set<HKObjectType> = [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
        ]
        _ = try? await store.requestAuthorization(toShare: share, read: read)
    }

    func begin() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            s.startActivity(with: Date())
            b.beginCollection(withStart: Date()) { _, _ in }
            session = s
            builder = b
        } catch {
            session = nil
            builder = nil
        }
    }

    /// After a relaunch mid-session (process killed, crash, reboot) the
    /// in-memory HKWorkoutSession is gone but HealthKit may still hold the
    /// live one. Reattach to it; otherwise start a fresh one. Either way
    /// the wrist ends up with a RUNNING workout again — which is what
    /// keeps the app frontmost and the always-on face on this screen
    /// instead of the clock (owner, 2026-09-01: "app should prevent apple
    /// watch go sleep").
    func recoverOrBegin() async {
        guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
        let recovered: HKWorkoutSession? = await withCheckedContinuation { cont in
            store.recoverActiveWorkoutSession { s, _ in cont.resume(returning: s) }
        }
        if let s = recovered, s.state == .running || s.state == .paused || s.state == .prepared {
            let b = s.associatedWorkoutBuilder()
            if b.dataSource == nil {
                b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: s.workoutConfiguration)
            }
            if s.state == .paused { s.resume() }
            session = s
            builder = b
        } else {
            begin()
        }
    }

    /// Ends the session and returns the recorded HKWorkout's uuid, or nil if
    /// HealthKit was unavailable the whole way through.
    func end() async -> String? {
        guard let s = session, let b = builder else { return nil }
        session = nil
        builder = nil
        s.end()
        return await withCheckedContinuation { cont in
            b.endCollection(withEnd: Date()) { _, _ in
                b.finishWorkout { workout, _ in
                    cont.resume(returning: workout?.uuid.uuidString)
                }
            }
        }
    }

    /// Ends WITHOUT saving an HKWorkout — a discarded session must leave no
    /// trace for the phone's detect to resurrect (adversary review).
    func abort() {
        guard let s = session, let b = builder else { return }
        session = nil
        builder = nil
        s.end()
        b.endCollection(withEnd: Date()) { _, _ in
            b.discardWorkout()
        }
    }

    var isRunning: Bool { session != nil }
}
