import Foundation
import HealthKit

/// Wraps the HKWorkoutSession so heart rate, rings and the always-on session
/// UI come free, and so the finished HKWorkout's uuid rides the POST as the
/// dedupe key against the phone's auto-detect (docs/WATCH.md). Every path is
/// graceful: HealthKit denied or failing never blocks logging — the uuid is
/// simply nil and the clientSaveId dedupe still holds.
final class WorkoutManager: NSObject, ObservableObject, HKWorkoutSessionDelegate {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    /// Is a workout session really running? It is what keeps the app on the
    /// wrist between sets, and begin() used to fail silently — the card shows
    /// a tappable heart only when this is false (tap = recoverOrBegin).
    @Published private(set) var isActive = false

    private func setActive(_ on: Bool) {
        if Thread.isMainThread { isActive = on } else { DispatchQueue.main.async { self.isActive = on } }
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let share: Set<HKSampleType> = [HKObjectType.workoutType()]
        let read: Set<HKObjectType> = [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
        ]
        _ = try? await store.requestAuthorization(toShare: share, read: read)
    }

    /// `startDate` backdates the workout to when the session really began —
    /// a session continued from the phone starts its HKWorkout at the
    /// phone's first set, so the saved workout spans the whole session
    /// (owner's call, 2026-09-01; the phone half has no heart-rate curve).
    func begin(startDate: Date = Date()) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        let start = min(startDate, Date())
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            s.delegate = self
            s.startActivity(with: start)
            b.beginCollection(withStart: start) { _, _ in }
            session = s
            builder = b
            setActive(true)
        } catch {
            session = nil
            builder = nil
            setActive(false)
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
            s.delegate = self
            session = s
            builder = b
            setActive(true)
        } else {
            begin()
        }
    }

    // MARK: HKWorkoutSessionDelegate — the truth about the session, not the hope.

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard workoutSession === session else { return }
        setActive(toState == .running || toState == .paused || toState == .prepared)
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        guard workoutSession === session else { return }
        setActive(false)
    }

    /// Ends the session and returns the recorded HKWorkout's uuid, or nil if
    /// HealthKit was unavailable the whole way through. HARD-DEADLINED:
    /// HealthKit's completion handlers are not guaranteed to fire (an
    /// entitlement refusal on the sim never called back and hung Finish on
    /// "Saving…" forever), so a GCD timer resumes the continuation with nil
    /// after 10 s no matter what — the uuid is a dedupe nicety, never worth
    /// the session. The lock guarantees exactly one resume.
    func end() async -> String? {
        guard let s = session, let b = builder else { return nil }
        session = nil
        builder = nil
        setActive(false)
        s.end()
        return await withCheckedContinuation { cont in
            let lock = NSLock()
            var resumed = false
            func finishOnce(_ v: String?) {
                lock.lock()
                let first = !resumed
                resumed = true
                lock.unlock()
                if first { cont.resume(returning: v) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 10) { finishOnce(nil) }
            b.endCollection(withEnd: Date()) { _, _ in
                b.finishWorkout { workout, _ in
                    finishOnce(workout?.uuid.uuidString)
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
        setActive(false)
        s.end()
        b.endCollection(withEnd: Date()) { _, _ in
            b.discardWorkout()
        }
    }

    var isRunning: Bool { session != nil }
}
