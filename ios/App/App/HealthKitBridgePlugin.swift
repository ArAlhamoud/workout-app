// SOURCE OF TRUTH. ios/App/App/HealthKitBridgePlugin.swift is a copy that the
// Xcode target compiles; `npm run ios:deploy` overwrites it from this file on
// every build. Edit here, never there — an edit to the copy is silently lost,
// and a build from a stale copy once shipped a known-broken binary that looked
// like a fresh one.

import Foundation
import Capacitor
import HealthKit

/// HealthKit bridge for the Workout app (Capacitor 6+/8 plugin conventions).
///
/// Two layers live here:
///
/// - **Purpose-built calls** — `queryWeight`, `queryWorkoutStats`, `saveWorkout`.
///   The web app calls these today; they keep working unchanged.
/// - **Generic, string-driven readers** — `queryQuantity`, `queryCategory`,
///   `queryDailyStats`, `queryWorkouts`. These take a HealthKit identifier as a
///   string, so new metrics ship as web deploys with no Xcode trip.
///
/// The read permission set is derived from `quantitySpecs` + `categorySpecs`,
/// so anything readable is also something we asked for. That matters: HealthKit
/// freezes read authorisation at request time, and a type not named in the
/// original request can never be read without a new build *and* a new
/// permission sheet.
///
/// Registered from the app target via `MainViewController` — see README.md.
@objc(HealthKitBridgePlugin)
public class HealthKitBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitBridge"
    public let jsName = "HealthKitBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWeight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWorkoutStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryQuantity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryCategory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryDailyStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWorkouts", returnType: CAPPluginReturnPromise)
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

    private static func daysAgo(_ n: Int) -> Date {
        return Calendar.current.date(byAdding: .day, value: -n, to: Date())
            ?? Date(timeIntervalSinceNow: -Double(n) * 24 * 60 * 60)
    }

    // MARK: - Type registry

    /// Whether a metric sums over a day (steps) or is averaged (heart rate).
    /// Drives the statistics option used by `queryDailyStats`.
    private enum Aggregation {
        case cumulative
        case discrete
    }

    private struct QuantitySpec {
        let identifier: HKQuantityTypeIdentifier
        let unit: HKUnit
        /// Returned to the web side verbatim so it never has to guess a unit.
        let unitName: String
        let aggregation: Aggregation
    }

    /// Every quantity type the app can read, keyed by the string the web sends.
    private static let quantitySpecs: [String: QuantitySpec] = {
        let kg = HKUnit.gramUnit(with: .kilo)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let kcal = HKUnit.kilocalorie()
        let ms = HKUnit.secondUnit(with: .milli)
        // HKUnit.percent() yields 0…1, not 0…100 — say so rather than mislabel it "%".
        let fraction = HKUnit.percent()

        var specs: [String: QuantitySpec] = [
            // Body composition
            "bodyMass": QuantitySpec(identifier: .bodyMass, unit: kg, unitName: "kg", aggregation: .discrete),
            "bodyFatPercentage": QuantitySpec(identifier: .bodyFatPercentage, unit: fraction, unitName: "fraction", aggregation: .discrete),
            "leanBodyMass": QuantitySpec(identifier: .leanBodyMass, unit: kg, unitName: "kg", aggregation: .discrete),
            "bodyMassIndex": QuantitySpec(identifier: .bodyMassIndex, unit: HKUnit.count(), unitName: "count", aggregation: .discrete),

            // Cardio / recovery
            "heartRate": QuantitySpec(identifier: .heartRate, unit: bpm, unitName: "count/min", aggregation: .discrete),
            // Blood pressure arrives from the home monitor via the Health app
            // as two samples per reading; the web side pairs them by timestamp.
            "bloodPressureSystolic": QuantitySpec(identifier: .bloodPressureSystolic, unit: HKUnit.millimeterOfMercury(), unitName: "mmHg", aggregation: .discrete),
            "bloodPressureDiastolic": QuantitySpec(identifier: .bloodPressureDiastolic, unit: HKUnit.millimeterOfMercury(), unitName: "mmHg", aggregation: .discrete),
            "restingHeartRate": QuantitySpec(identifier: .restingHeartRate, unit: bpm, unitName: "count/min", aggregation: .discrete),
            "heartRateVariabilitySDNN": QuantitySpec(identifier: .heartRateVariabilitySDNN, unit: ms, unitName: "ms", aggregation: .discrete),
            "respiratoryRate": QuantitySpec(identifier: .respiratoryRate, unit: bpm, unitName: "count/min", aggregation: .discrete),
            "oxygenSaturation": QuantitySpec(identifier: .oxygenSaturation, unit: fraction, unitName: "fraction", aggregation: .discrete),
            "vo2Max": QuantitySpec(identifier: .vo2Max, unit: HKUnit(from: "ml/kg*min"), unitName: "mL/kg*min", aggregation: .discrete),

            // Activity
            "stepCount": QuantitySpec(identifier: .stepCount, unit: HKUnit.count(), unitName: "count", aggregation: .cumulative),
            "distanceWalkingRunning": QuantitySpec(identifier: .distanceWalkingRunning, unit: HKUnit.meter(), unitName: "m", aggregation: .cumulative),
            "appleExerciseTime": QuantitySpec(identifier: .appleExerciseTime, unit: HKUnit.minute(), unitName: "min", aggregation: .cumulative),
            "activeEnergyBurned": QuantitySpec(identifier: .activeEnergyBurned, unit: kcal, unitName: "kcal", aggregation: .cumulative),
            "basalEnergyBurned": QuantitySpec(identifier: .basalEnergyBurned, unit: kcal, unitName: "kcal", aggregation: .cumulative),

            // Fitness tests
            "sixMinuteWalkTestDistance": QuantitySpec(identifier: .sixMinuteWalkTestDistance, unit: HKUnit.meter(), unitName: "m", aggregation: .discrete)
        ]

        // iOS 16+ only; the deployment target is 15.0.
        if #available(iOS 16.0, *) {
            specs["appleSleepingWristTemperature"] = QuantitySpec(
                identifier: .appleSleepingWristTemperature,
                unit: HKUnit.degreeCelsius(),
                unitName: "degC",
                aggregation: .discrete
            )
        }

        return specs
    }()

    private static let categorySpecs: [String: HKCategoryTypeIdentifier] = [
        "sleepAnalysis": .sleepAnalysis
    ]

    /// Legacy shorthands used by the purpose-built calls.
    private static let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass)
    private static let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)
    private static let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)

    private static let bpmUnit = HKUnit.count().unitDivided(by: .minute())
    private static let kgUnit = HKUnit.gramUnit(with: .kilo)

    // MARK: - Call plumbing

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

    /// Resolves the optional startISO/endISO window shared by the generic readers.
    /// Returns nil (after rejecting) when a supplied string doesn't parse.
    private func window(_ call: CAPPluginCall, defaultDays: Int) -> (start: Date, end: Date?)? {
        var start = Self.daysAgo(defaultDays)
        if let raw = call.getString("startISO") {
            guard let parsed = Self.parseISO(raw) else {
                call.reject("Invalid startISO date: \(raw)")
                return nil
            }
            start = parsed
        }

        var end: Date?
        if let raw = call.getString("endISO") {
            guard let parsed = Self.parseISO(raw) else {
                call.reject("Invalid endISO date: \(raw)")
                return nil
            }
            guard parsed > start else {
                call.reject("endISO must be after startISO")
                return nil
            }
            end = parsed
        }

        return (start, end)
    }

    private static func unknownIdentifier(_ name: String, known: [String]) -> String {
        return "Unknown HealthKit identifier \"\(name)\". Known: \(known.sorted().joined(separator: ", "))"
    }

    // MARK: - requestAuthorization

    /// Requests read access to every type in the registry plus sleep and
    /// workouts, and share (write) access to workouts + active energy.
    ///
    /// Resolves { granted: Bool, readTypes: [String] }. Note: HealthKit never
    /// reveals *read* grant state — `granted` only reflects that the request
    /// completed, and `readTypes` reports what was asked for, not what was
    /// allowed.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }

        var readTypes: Set<HKObjectType> = [HKObjectType.workoutType()]
        var requested: [String] = ["workoutType"]

        for (name, spec) in Self.quantitySpecs {
            guard let type = HKQuantityType.quantityType(forIdentifier: spec.identifier) else { continue }
            readTypes.insert(type)
            requested.append(name)
        }
        for (name, identifier) in Self.categorySpecs {
            guard let type = HKCategoryType.categoryType(forIdentifier: identifier) else { continue }
            readTypes.insert(type)
            requested.append(name)
        }

        // Write access stays deliberately narrow: we only ever author workouts.
        var shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        if let activeEnergy = Self.activeEnergyType { shareTypes.insert(activeEnergy) }

        // NOTE: capture self strongly. With [weak self] a deallocated plugin
        // makes this closure return without resolving OR rejecting, which hangs
        // the JS promise forever and leaves the UI stuck on "Connecting…".
        // The call must always be settled exactly once.
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { success, error in
            if let error = error {
                self.rejectOnMain(call, "Health authorization failed: \(error.localizedDescription)", error)
                return
            }
            self.resolveOnMain(call, ["granted": success, "readTypes": requested.sorted()])
        }
    }

    // MARK: - queryQuantity (generic)

    /// Options: { identifier: String, startISO?: String, endISO?: String, limit?: Int }.
    /// Defaults to the last 90 days, ascending, unlimited.
    /// Resolves { samples: [{ value, unit, dateISO, sourceName }], unit }.
    @objc func queryQuantity(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let name = call.getString("identifier") else {
            call.reject("identifier is required")
            return
        }
        guard let spec = Self.quantitySpecs[name] else {
            call.reject(Self.unknownIdentifier(name, known: Array(Self.quantitySpecs.keys)))
            return
        }
        guard let type = HKQuantityType.quantityType(forIdentifier: spec.identifier) else {
            call.reject("HealthKit type unavailable on this device: \(name)")
            return
        }
        guard let range = window(call, defaultDays: 90) else { return }

        let limit = call.getInt("limit") ?? HKObjectQueryNoLimit
        let predicate = HKQuery.predicateForSamples(withStart: range.start, end: range.end, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(
            sampleType: type,
            predicate: predicate,
            limit: limit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                self.rejectOnMain(call, "\(name) query failed: \(error.localizedDescription)", error)
                return
            }
            let out: [[String: Any]] = ((samples as? [HKQuantitySample]) ?? []).map { sample in
                [
                    "value": sample.quantity.doubleValue(for: spec.unit),
                    "unit": spec.unitName,
                    "dateISO": Self.isoString(from: sample.startDate),
                    "sourceName": sample.sourceRevision.source.name
                ]
            }
            self.resolveOnMain(call, ["samples": out, "unit": spec.unitName])
        }
        healthStore.execute(query)
    }

    // MARK: - queryCategory (generic)

    /// Options: { identifier: String, startISO?: String, endISO?: String }.
    /// Defaults to the last 30 days, ascending.
    /// Resolves { samples: [{ value: Int, startISO, endISO, sourceName }] }.
    /// For sleepAnalysis, `value` is the raw HKCategoryValueSleepAnalysis.
    @objc func queryCategory(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let name = call.getString("identifier") else {
            call.reject("identifier is required")
            return
        }
        guard let identifier = Self.categorySpecs[name] else {
            call.reject(Self.unknownIdentifier(name, known: Array(Self.categorySpecs.keys)))
            return
        }
        guard let type = HKCategoryType.categoryType(forIdentifier: identifier) else {
            call.reject("HealthKit type unavailable on this device: \(name)")
            return
        }
        guard let range = window(call, defaultDays: 30) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: range.start, end: range.end, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(
            sampleType: type,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                self.rejectOnMain(call, "\(name) query failed: \(error.localizedDescription)", error)
                return
            }
            let out: [[String: Any]] = ((samples as? [HKCategorySample]) ?? []).map { sample in
                [
                    "value": sample.value,
                    "startISO": Self.isoString(from: sample.startDate),
                    "endISO": Self.isoString(from: sample.endDate),
                    "sourceName": sample.sourceRevision.source.name
                ]
            }
            self.resolveOnMain(call, ["samples": out])
        }
        healthStore.execute(query)
    }

    // MARK: - queryDailyStats (generic)

    /// Options: { identifier: String, days: Int (1…365) }.
    /// One bucket per calendar day, oldest first, ending today.
    /// Resolves { days: [{ dateISO, value, unit }], unit }.
    ///
    /// `value` is null when HealthKit holds no samples for that day — callers
    /// may treat null as 0 for cumulative metrics, but the distinction between
    /// "no data" and "genuinely zero" is not ours to invent.
    @objc func queryDailyStats(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let name = call.getString("identifier") else {
            call.reject("identifier is required")
            return
        }
        guard let spec = Self.quantitySpecs[name] else {
            call.reject(Self.unknownIdentifier(name, known: Array(Self.quantitySpecs.keys)))
            return
        }
        guard let type = HKQuantityType.quantityType(forIdentifier: spec.identifier) else {
            call.reject("HealthKit type unavailable on this device: \(name)")
            return
        }
        let days = call.getInt("days") ?? 30
        guard days >= 1, days <= 365 else {
            call.reject("days must be between 1 and 365 (got \(days))")
            return
        }

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: today),
              let end = calendar.date(byAdding: .day, value: 1, to: today) else {
            call.reject("Could not build the day range")
            return
        }

        let options: HKStatisticsOptions = spec.aggregation == .cumulative ? .cumulativeSum : .discreteAverage
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        let query = HKStatisticsCollectionQuery(
            quantityType: type,
            quantitySamplePredicate: predicate,
            options: options,
            anchorDate: start,
            intervalComponents: DateComponents(day: 1)
        )

        query.initialResultsHandler = { _, collection, error in
            if let error = error {
                self.rejectOnMain(call, "\(name) daily stats failed: \(error.localizedDescription)", error)
                return
            }
            guard let collection = collection else {
                self.rejectOnMain(call, "\(name) daily stats returned no collection")
                return
            }

            var out: [[String: Any]] = []
            collection.enumerateStatistics(from: start, to: end) { stats, _ in
                let quantity = spec.aggregation == .cumulative ? stats.sumQuantity() : stats.averageQuantity()
                out.append([
                    "dateISO": Self.isoString(from: stats.startDate),
                    "value": quantity.map { $0.doubleValue(for: spec.unit) } as Any? ?? NSNull(),
                    "unit": spec.unitName
                ])
            }
            self.resolveOnMain(call, ["days": out, "unit": spec.unitName])
        }

        healthStore.execute(query)
    }

    // MARK: - queryWorkouts

    /// Options: { sinceISO?: String } — defaults to the last 90 days.
    /// Resolves { workouts: [{ uuid, startISO, endISO, activityType,
    /// activityTypeRaw, durationSec, energyKcal, sourceName, sourceBundleId }] }
    /// ascending. `energyKcal` is null when the workout carries no energy total.
    @objc func queryWorkouts(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }

        var since = Self.daysAgo(90)
        if let raw = call.getString("sinceISO") {
            guard let parsed = Self.parseISO(raw) else {
                call.reject("Invalid sinceISO date: \(raw)")
                return
            }
            since = parsed
        }

        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                self.rejectOnMain(call, "Workout query failed: \(error.localizedDescription)", error)
                return
            }
            let out: [[String: Any]] = ((samples as? [HKWorkout]) ?? []).map { workout in
                let source = workout.sourceRevision.source
                return [
                    "uuid": workout.uuid.uuidString,
                    "startISO": Self.isoString(from: workout.startDate),
                    "endISO": Self.isoString(from: workout.endDate),
                    "activityType": Self.activityName(workout.workoutActivityType),
                    "activityTypeRaw": workout.workoutActivityType.rawValue,
                    "durationSec": Int(workout.duration.rounded()),
                    "energyKcal": self.energyKcal(of: workout) as Any? ?? NSNull(),
                    "sourceName": source.name,
                    "sourceBundleId": source.bundleIdentifier
                ]
            }
            self.resolveOnMain(call, ["workouts": out])
        }
        healthStore.execute(query)
    }

    /// Total active energy for a workout, in kcal.
    private func energyKcal(of workout: HKWorkout) -> Double? {
        if #available(iOS 16.0, *), let energyType = Self.activeEnergyType {
            if let sum = workout.statistics(for: energyType)?.sumQuantity() {
                return sum.doubleValue(for: .kilocalorie())
            }
        }
        return workout.totalEnergyBurned?.doubleValue(for: .kilocalorie())
    }

    /// Readable name for the activity type. `activityTypeRaw` is always
    /// returned alongside, so an unmapped type still round-trips losslessly.
    private static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .traditionalStrengthTraining: return "traditionalStrengthTraining"
        case .functionalStrengthTraining: return "functionalStrengthTraining"
        case .highIntensityIntervalTraining: return "highIntensityIntervalTraining"
        case .coreTraining: return "coreTraining"
        case .flexibility: return "flexibility"
        case .yoga: return "yoga"
        case .pilates: return "pilates"
        case .running: return "running"
        case .walking: return "walking"
        case .hiking: return "hiking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .rowing: return "rowing"
        case .elliptical: return "elliptical"
        case .stairClimbing: return "stairClimbing"
        case .mixedCardio: return "mixedCardio"
        case .cooldown: return "cooldown"
        case .preparationAndRecovery: return "preparationAndRecovery"
        case .other: return "other"
        default: return "unknown"
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
            since = Self.daysAgo(90)
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

    /// Options: { startISO, endISO, kcal?, name?, segments?, metadata? }.
    ///   segments: [{ startISO, endISO }] — recorded as .segment workout events.
    ///   metadata: { key: string | number | boolean } — merged into the workout.
    /// Saves an HKWorkout (.traditionalStrengthTraining). Resolves { saved: true }.
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

        // Parse segments up front: a bad interval should fail before we open a
        // builder, not halfway through collection.
        var events: [HKWorkoutEvent] = []
        for raw in (call.getArray("segments") as? [Any]) ?? [] {
            guard let seg = raw as? [String: Any],
                  let sRaw = seg["startISO"] as? String,
                  let eRaw = seg["endISO"] as? String,
                  let sDate = Self.parseISO(sRaw),
                  let eDate = Self.parseISO(eRaw) else {
                call.reject("Each segment needs parseable startISO and endISO")
                return
            }
            guard eDate >= sDate else {
                call.reject("Segment endISO must not precede startISO (\(sRaw) → \(eRaw))")
                return
            }
            events.append(HKWorkoutEvent(
                type: .segment,
                dateInterval: DateInterval(start: sDate, end: eDate),
                metadata: nil
            ))
        }

        var metadata: [String: Any] = [:]
        if let name = name, !name.isEmpty {
            // Brand-name metadata carries the app's workout title into Health.
            metadata[HKMetadataKeyWorkoutBrandName] = name
        }
        for (key, value) in (call.getObject("metadata") as? [String: Any]) ?? [:] {
            // HealthKit only stores string/number/date/quantity values.
            if let s = value as? String {
                metadata[key] = s
            } else if let n = value as? NSNumber {
                metadata[key] = n
            }
        }

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
                if metadata.isEmpty {
                    finish()
                } else {
                    builder.addMetadata(metadata) { _, _ in finish() }
                }
            }

            let addEventsThenMetadata: () -> Void = {
                if events.isEmpty {
                    addMetadataThenFinish()
                } else {
                    builder.addWorkoutEvents(events) { added, error in
                        guard added else {
                            fail("Could not attach workout segments: \(error?.localizedDescription ?? "unknown error")", error)
                            return
                        }
                        addMetadataThenFinish()
                    }
                }
            }

            var samples: [HKSample] = []
            if let kcal = kcal, kcal > 0, let energyType = Self.activeEnergyType {
                let quantity = HKQuantity(unit: .kilocalorie(), doubleValue: kcal)
                samples.append(HKQuantitySample(type: energyType, quantity: quantity, start: start, end: end))
            }

            if samples.isEmpty {
                addEventsThenMetadata()
            } else {
                builder.add(samples) { added, error in
                    guard added else {
                        fail("Could not attach energy sample: \(error?.localizedDescription ?? "unknown error")", error)
                        return
                    }
                    addEventsThenMetadata()
                }
            }
        }
    }
}
