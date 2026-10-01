// SOURCE OF TRUTH. ios/App/App/RestActivityPlugin.swift is a copy that the
// Xcode target compiles; `npm run ios:deploy` overwrites it from this file on
// every build. Edit here, never there.

import Foundation
import Capacitor
import UIKit
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Rest-timer Live Activity bridge (Dynamic Island + Lock Screen).
///
/// One activity at a time, by design — there is only ever one rest running.
/// `start` is start-or-update: RestTimer calls it on mount AND on every
/// ±15/30 s adjust, and recreating the activity on each adjust would flicker
/// the Island and burn the OS's activity-creation budget. `end` is called
/// when the timer hits 0:00 or unmounts (skip, done, workout saved).
///
/// JS is suspended while the phone is locked, so `end` often does NOT arrive
/// at 0:00 (he pockets the phone and carries on from the Watch). Three things
/// cover that, none of them needing JS:
///   1. `staleDate` = the rest's end. The OS does NOT grey or remove a stale
///      activity — it only sets `context.isStale`. RestActivityWidget reads
///      that flag and draws a dimmed "rest over" state.
///   2. A native task ends the activity a few seconds after the deadline, for
///      as long as the process is running.
///   3. A sweep on every return to the foreground ends whatever expired while
///      the process was suspended.
/// ActivityKit offers no way to schedule a removal in advance without ending
/// the activity on the spot (which drops it from the Island mid-rest), so a
/// suspended app leaves the dimmed state up until it next runs.
///
/// Every operation runs through ONE serial chain (`enqueue`): as unordered
/// Tasks, a dismiss followed at once by a new rest could end the new activity.
///
/// Also hosts `reloadWidgets` — the Home-screen verdict otherwise waits out
/// its 30-minute timeline after a workout is saved.
///
/// Registered from the app target via `MainViewController` — see README.md.
@objc(RestActivityPlugin)
public class RestActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestActivity"
    public let jsName = "RestActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidgets", returnType: CAPPluginReturnPromise)
    ]

    /// How long the finished state may sit before the native side removes it.
    /// JS ends the activity at 0:00 itself when it is awake; this is the
    /// fallback, so it only needs to be long enough not to race that call.
    private static let endGraceSeconds: TimeInterval = 4

    // MARK: Serial chain

    private let chainLock = NSLock()
    private var chainTail: Task<Void, Never>?
    private var autoEndTask: Task<Void, Never>?

    /// Runs `operation` after every previously enqueued one has finished.
    private func enqueue(_ operation: @escaping () async -> Void) {
        chainLock.lock()
        defer { chainLock.unlock() }
        let previous = chainTail
        chainTail = Task {
            await previous?.value
            await operation()
        }
    }

    private func replaceAutoEnd(_ task: Task<Void, Never>?) {
        chainLock.lock()
        defer { chainLock.unlock() }
        autoEndTask?.cancel()
        autoEndTask = task
    }

    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appBecameActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func appBecameActive() {
        guard #available(iOS 16.2, *) else { return }
        enqueue { await Self.endExpired() }
    }

    /// Ends every activity whose rest is over. Judged per activity by its OWN
    /// deadline, so it can never take down a rest that was just started.
    @available(iOS 16.2, *)
    private static func endExpired() async {
        let now = Date()
        for activity in Activity<RestTimerAttributes>.activities
        where activity.content.state.endsAt.addingTimeInterval(endGraceSeconds) <= now {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Arms the native fallback for a rest ending at `endsAt`. A suspended
    /// process sleeps through it; the foreground sweep catches that case.
    @available(iOS 16.2, *)
    private func scheduleAutoEnd(at endsAt: Date) {
        let deadline = endsAt.addingTimeInterval(Self.endGraceSeconds)
        replaceAutoEnd(Task { [weak self] in
            while !Task.isCancelled {
                let remaining = deadline.timeIntervalSinceNow
                if remaining <= 0 { break }
                try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            self?.enqueue { await Self.endExpired() }
        })
    }

    // MARK: Plugin methods

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
        // Stale exactly when the rest is over: that is the moment the widget
        // must stop looking like a running timer.
        let content = ActivityContent(state: state, staleDate: endsAt)

        enqueue { [weak self] in
            // ActivityKit freezes attributes at creation, so an activity for a
            // DIFFERENT exercise can never be updated into this one — it has
            // to die. That covers the two ways a mismatch really happens: a
            // set ticked mid-rest (new exercise replaces the old rest), and an
            // orphan surviving from a run that was killed mid-rest. Adjust
            // taps land on the matching activity and update it in place. An
            // activity that is no longer active cannot be updated either.
            var current: Activity<RestTimerAttributes>? = nil
            for activity in Activity<RestTimerAttributes>.activities {
                if current == nil
                    && activity.attributes.exerciseName == exerciseName
                    && (activity.activityState == .active || activity.activityState == .stale) {
                    current = activity
                } else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }

            if let current {
                await current.update(content)
                self?.scheduleAutoEnd(at: endsAt)
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
                self?.scheduleAutoEnd(at: endsAt)
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
        replaceAutoEnd(nil)
        enqueue {
            for activity in Activity<RestTimerAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    /// Asks WidgetKit to re-run every widget timeline now (the verdict widget
    /// refetches /api/verdict). Called after a workout save and on foreground.
    @objc func reloadWidgets(_ call: CAPPluginCall) {
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
