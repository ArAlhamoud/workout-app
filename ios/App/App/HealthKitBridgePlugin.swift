import Foundation
import Capacitor
import HealthKit

/// Minimal HealthKit bridge for the Workout app (Capacitor 6+ plugin conventions).
///
/// Reads body mass / heart rate / active energy, writes strength-training
/// workouts. Registered from the app target via `MainViewController` — see
/// README.md in this folder for the exact Xcode wiring steps.
@objc(HealthKitBridgePlugin)
public class HealthKitBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitBridge"
    public let jsName = "HealthKitBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWeight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWorkoutStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    // MARK: - Date helpers

    /// ISO-8601 with fractional seconds ("2026-07-31T18:05:32.123Z").
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// ISO-8601 without fractional seconds ("2026-07-31T18:05:32Z").
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func parseISO(_ string: String) -> Date? {
        return isoFractional.date(from: string) ?? isoPlain.date(from: string)
    }

    private static func isoString(from date: Date) -> String {
        return isoPlain.string(from: date)
    }

    // MARK: - Type helpers

    private static let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass)
    private static let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)
    private static let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)

    private static let bpmUnit = HKUnit.count().unitDivided(by: .minute())
    private static let kgUnit = HKUnit.gramUnit(with: .kilo)

    /// Rejects the call (on the main queue) when HealthKit is unavailable.
    private func guardAvailable(_ call: CAPPluginCall) -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return false
        }
        return true
    }

    private func resolveOnMain(_ call: CAPPluginCall, _ data: PluginCallResultData) {
        DispatchQueue.main.async { call.resolve(data) }
    }

    private func rejectOnMain(_ call: CAPPluginCall, _ message: String, _ error: Error? = nil) {
        DispatchQueue.main.async { call.reject(message, nil, error) }
    }

    // MARK: - requestAuthorization

    /// Requests read access to bodyMass / heartRate / activeEnergyBurned /
    /// workouts and share (write) access to workouts + activeEnergyBurned.
    /// Resolves { granted: Bool }. Note: HealthKit never reveals *read* grant
    /// state — `granted` only reflects that the request completed.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let bodyMass = Self.bodyMassType,
              let heartRate = Self.heartRateType,
              let activeEnergy = Self.activeEnergyType else {
            call.reject("HealthKit quantity types unavailable")
            return
        }

        let readTypes: Set<HKObjectType> = [bodyMass, heartRate, activeEnergy, HKObjectType.workoutType()]
        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType(), activeEnergy]

        // NOTE: capture self strongly. With [weak self] a deallocated plugin
        // makes this closure return without resolving OR rejecting, which hangs
        // the JS promise forever and leaves the UI stuck on "Connecting…".
        // The call must always be settled exactly once.
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { success, error in
            if let error = error {
                self.rejectOnMain(call, "Health authorization failed: \(error.localizedDescription)", error)
                return
            }
            self.resolveOnMain(call, ["granted": success])
        }
    }

    // MARK: - queryWeight

    /// Options: { sinceISO?: String } — defaults to the last 90 days.
    /// Resolves { samples: [{ value: Double (kg), dateISO: String }] } sorted ascending.
    @objc func queryWeight(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let bodyMass = Self.bodyMassType else {
            call.reject("HealthKit bodyMass type unavailable")
            return
        }

        let since: Date
        if let sinceISO = call.getString("sinceISO") {
            guard let parsed = Self.parseISO(sinceISO) else {
                call.reject("Invalid sinceISO date: \(sinceISO)")
                return
            }
            since = parsed
        } else {
            since = Calendar.current.date(byAdding: .day, value: -90, to: Date())
                ?? Date(timeIntervalSinceNow: -90 * 24 * 60 * 60)
        }

        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(
            sampleType: bodyMass,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                self.rejectOnMain(call, "Weight query failed: \(error.localizedDescription)", error)
                return
            }
            let quantitySamples = (samples as? [HKQuantitySample]) ?? []
            let out: [[String: Any]] = quantitySamples.map { sample in
                [
                    "value": sample.quantity.doubleValue(for: Self.kgUnit),
                    "dateISO": Self.isoString(from: sample.startDate)
                ]
            }
            self.resolveOnMain(call, ["samples": out])
        }
        healthStore.execute(query)
    }

    // MARK: - queryWorkoutStats

    /// Options: { startISO: String, endISO: String }.
    /// Resolves { avgHr: Int?, maxHr: Int?, activeKcal: Int? } — HR in count/min,
    /// energy in kcal. Missing data (or per-metric query errors, e.g. no samples)
    /// resolves as null rather than rejecting.
    @objc func queryWorkoutStats(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let heartRate = Self.heartRateType, let activeEnergy = Self.activeEnergyType else {
            call.reject("HealthKit quantity types unavailable")
            return
        }
        guard let startISO = call.getString("startISO"), let start = Self.parseISO(startISO) else {
            call.reject("startISO (ISO-8601 string) is required")
            return
        }
        guard let endISO = call.getString("endISO"), let end = Self.parseISO(endISO) else {
            call.reject("endISO (ISO-8601 string) is required")
            return
        }
        guard end > start else {
            call.reject("endISO must be after startISO")
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let group = DispatchGroup()

        // Written from separate query callbacks — no shared writes, no race.
        var avgHr: Double?
        var maxHr: Double?
        var activeKcal: Double?

        group.enter()
        let hrQuery = HKStatisticsQuery(
            quantityType: heartRate,
            quantitySamplePredicate: predicate,
            options: [.discreteAverage, .discreteMax]
        ) { _, stats, _ in
            avgHr = stats?.averageQuantity()?.doubleValue(for: Self.bpmUnit)
            maxHr = stats?.maximumQuantity()?.doubleValue(for: Self.bpmUnit)
            group.leave()
        }
        healthStore.execute(hrQuery)

        group.enter()
        let energyQuery = HKStatisticsQuery(
            quantityType: activeEnergy,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, stats, _ in
            activeKcal = stats?.sumQuantity()?.doubleValue(for: .kilocalorie())
            group.leave()
        }
        healthStore.execute(energyQuery)

        group.notify(queue: .main) {
            call.resolve([
                "avgHr": avgHr.map { Int($0.rounded()) } as Any? ?? NSNull(),
                "maxHr": maxHr.map { Int($0.rounded()) } as Any? ?? NSNull(),
                "activeKcal": activeKcal.map { Int($0.rounded()) } as Any? ?? NSNull()
            ])
        }
    }

    // MARK: - saveWorkout

    /// Options: { startISO: String, endISO: String, kcal?: Double, name?: String }.
    /// Saves an HKWorkout (.traditionalStrengthTraining) with total energy burned.
    /// Resolves { saved: true }.
    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let startISO = call.getString("startISO"), let start = Self.parseISO(startISO) else {
            call.reject("startISO (ISO-8601 string) is required")
            return
        }
        guard let endISO = call.getString("endISO"), let end = Self.parseISO(endISO) else {
            call.reject("endISO (ISO-8601 string) is required")
            return
        }
        guard end > start else {
            call.reject("endISO must be after startISO")
            return
        }
        let kcal = call.getDouble("kcal")
        let name = call.getString("name")

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining

        let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: .local())

        func fail(_ message: String, _ error: Error?) {
            builder.discardWorkout()
            self.rejectOnMain(call, message, error)
        }

        builder.beginCollection(withStart: start) { began, error in
            guard began else {
                fail("Could not begin workout collection: \(error?.localizedDescription ?? "unknown error")", error)
                return
            }

            let finish: () -> Void = {
                builder.endCollection(withEnd: end) { ended, error in
                    guard ended else {
                        fail("Could not end workout collection: \(error?.localizedDescription ?? "unknown error")", error)
                        return
                    }
                    builder.finishWorkout { workout, error in
                                    guard workout != nil else {
                            self.rejectOnMain(call, "Could not save workout: \(error?.localizedDescription ?? "unknown error")", error)
                            return
                        }
                        self.resolveOnMain(call, ["saved": true])
                    }
                }
            }

            let addMetadataThenFinish: () -> Void = {
                if let name = name, !name.isEmpty {
                    // Brand-name metadata carries the app's workout title into Health.
                    builder.addMetadata([HKMetadataKeyWorkoutBrandName: name]) { _, _ in finish() }
                } else {
                    finish()
                }
            }

            var samples: [HKSample] = []
            if let kcal = kcal, kcal > 0, let energyType = Self.activeEnergyType {
                let quantity = HKQuantity(unit: .kilocalorie(), doubleValue: kcal)
                samples.append(HKQuantitySample(type: energyType, quantity: quantity, start: start, end: end))
            }

            if samples.isEmpty {
                addMetadataThenFinish()
            } else {
                builder.add(samples) { added, error in
                    guard added else {
                        fail("Could not attach energy sample: \(error?.localizedDescription ?? "unknown error")", error)
                        return
                    }
                    addMetadataThenFinish()
                }
            }
        }
    }
}
