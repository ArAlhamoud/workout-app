// SOURCE OF TRUTH. ios/App/App/RestActivityPlugin.swift is a copy that the
// Xcode target compiles; `npm run ios:deploy` overwrites it from this file on
// every build. Edit here, never there.

import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Rest-timer Live Activity bridge (Dynamic Island + Lock Screen).
///
/// One activity at a time, by design — there is only ever one rest running.
/// `start` is start-or-update: RestTimer calls it on mount AND on every
/// ±15/30 s adjust, and recreating the activity on each adjust would flicker
/// the Island and burn the OS's activity-creation budget. `end` is called only
/// when the timer unmounts (skip, done, workout saved).
///
/// If the app is killed mid-rest, `end` never arrives — the staleDate set at
/// request time lets the OS grey the activity out shortly after the rest is
/// over, instead of showing a frozen countdown for hours.
///
/// Registered from the app target via `MainViewController` — see README.md.
@objc(RestActivityPlugin)
public class RestActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestActivity"
    public let jsName = "RestActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endRest", returnType: CAPPluginReturnPromise)
    ]

    /// The Island shows a stopped clock at 0:00 for this long, then the OS may
    /// remove the activity on its own. Long enough to glance, short enough not
    /// to haunt the Lock Screen.
    private static let staleAfterEndSeconds: TimeInterval = 120

    @objc func startRest(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            // Old iOS: the in-app timer and the local notification still cover
            // the rest — absence of an Island is not an error.
            return call.resolve(["started": false, "reason": "requires iOS 16.2"])
        }
        guard let endsAtMs = call.getDouble("endsAtMs"), endsAtMs > 0 else {
            return call.reject("endsAtMs (epoch milliseconds) is required")
        }
        let exerciseName = call.getString("exerciseName") ?? "Next set"
        let totalSeconds = max(1, call.getInt("totalSeconds") ?? 60)
        let endsAt = Date(timeIntervalSince1970: endsAtMs / 1000)

        let state = RestTimerAttributes.ContentState(endsAt: endsAt, totalSeconds: totalSeconds)
        let content = ActivityContent(
            state: state,
            staleDate: endsAt.addingTimeInterval(Self.staleAfterEndSeconds)
        )

        Task {
            // Adjust taps land here with an activity already up: update it.
            // The attributes (exercise name) are fixed per rest, and a new set
            // always ends the previous timer first, so first-match is THE one.
            if let existing = Activity<RestTimerAttributes>.activities.first {
                await existing.update(content)
                call.resolve(["started": true, "mode": "updated"])
                return
            }

            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                // User disabled Live Activities in Settings — their call.
                call.resolve(["started": false, "reason": "disabled in Settings"])
                return
            }

            do {
                _ = try Activity.request(
                    attributes: RestTimerAttributes(exerciseName: exerciseName),
                    content: content
                )
                call.resolve(["started": true, "mode": "started"])
            } catch {
                // Not a rejection: the rest timer works without the Island,
                // and a Live Activity failure must never break a set.
                call.resolve(["started": false, "reason": error.localizedDescription])
            }
        }
    }

    @objc func endRest(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        Task {
            for activity in Activity<RestTimerAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }
}
