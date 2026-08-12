// The rest-timer Live Activity's shared contract. Compiled into BOTH the app
// target (RestActivityPlugin starts/ends activities) and the widget extension
// (RestActivityWidget renders them) — the two sides must agree byte-for-byte,
// which is why this is one file with two target memberships, not two copies.

import ActivityKit
import Foundation

// The app target still declares iOS 15.0; ActivityKit exists from 16.1. The
// annotation keeps the shared file compilable on both sides — the plugin
// checks #available before touching it.
@available(iOS 16.1, *)
struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the rest ends. The OS renders the countdown itself via
        /// Text(timerInterval:), so a +15 s adjust is one update, not a tick
        /// stream.
        var endsAt: Date
        /// Full rest length, so the progress bar has a denominator.
        var totalSeconds: Int
    }

    /// Rendered as "Next: <name>". Fixed for the life of one rest.
    var exerciseName: String
}
