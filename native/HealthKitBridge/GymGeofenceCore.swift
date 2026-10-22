// SOURCE OF TRUTH. ios/App/App/GymGeofenceCore.swift is a copy the Xcode
// target compiles; `npm run ios:deploy` overwrites it from this file. Edit here.
//
// Foundation only, so scripts/geofence-core-tests builds it with plain swiftc
// (`npm run test:geofence`).

import Foundation

/// What the phone REPORTS about a gym region. Never a location: only which
/// gym, enter or exit, and when it happened. The server decides what a report
/// means (docs/GYM-GEOFENCE.md; rule 9 — no visit logic in Swift).
enum GeofenceKind: String, Codable { case enter, exit }

struct GeofenceEvent: Codable, Equatable {
    var id: String
    var kind: GeofenceKind
    var gym: String
    /// When the region event happened on the phone — never the send time.
    var at: Date
    /// When the server first answered this exit "none" (the 6 h clock of the
    /// maybe-later list). Nil until then.
    var firstNoneAt: Date? = nil
}

/// The phone's side of gym check-in/out, as one persisted value:
///
/// - `pendingExits`: he left the small circle; the exit waits until he has
///   been out long enough to rule out GPS drift or a walk to the car. It is
///   sent when he leaves the 600 m "away" area, or on any wake once it is
///   `exitDelay` old. Coming back first cancels it.
/// - `outbox`: events to POST, oldest first, one at a time (the server's
///   contract). Survives offline and relaunch.
/// - `maybeLater`: exits the server answered "none". If he taps an old
///   "Check in?" after leaving, that enter is accepted, and these exits are
///   what closes the visit again; unused, they go after `maybeLaterWindow`.
struct GeofenceQueue: Codable, Equatable {
    static let exitDelay: TimeInterval = 7 * 60
    static let maybeLaterWindow: TimeInterval = 6 * 3600

    var outbox: [GeofenceEvent] = []
    var pendingExits: [String: Date] = [:]
    var maybeLater: [GeofenceEvent] = []

    // MARK: Region events

    /// Entered a gym's small circle. True when the arrival prompt should be
    /// shown; false when this only cancels a pending exit (same stay).
    mutating func enteredGym(_ gym: String, at: Date) -> Bool {
        pendingExits.removeValue(forKey: gym) == nil
    }

    /// Left a gym's small circle: park the exit. A repeated exit with no
    /// re-entry between keeps the first time.
    mutating func exitedGym(_ gym: String, at: Date) {
        if pendingExits[gym] == nil { pendingExits[gym] = at }
    }

    /// Left the gym's 600 m area: he has really gone — send the parked exit
    /// with its small-circle time.
    mutating func leftAwayArea(_ gym: String, now: Date) {
        guard let exitAt = pendingExits.removeValue(forKey: gym) else { return }
        enqueue(GeofenceEvent(id: UUID().uuidString, kind: .exit, gym: gym, at: exitAt))
    }

    /// Any wake (launch, foreground, region event, notification action):
    /// send parked exits that are old enough, forget stale maybe-later exits.
    mutating func wake(now: Date) {
        for (gym, exitAt) in pendingExits where now.timeIntervalSince(exitAt) >= Self.exitDelay {
            pendingExits.removeValue(forKey: gym)
            enqueue(GeofenceEvent(id: UUID().uuidString, kind: .exit, gym: gym, at: exitAt))
        }
        maybeLater.removeAll { e in
            guard let first = e.firstNoneAt else { return true }
            return now.timeIntervalSince(first) > Self.maybeLaterWindow
        }
    }

    /// He tapped Check in on the arrival prompt: report the ENTRY time.
    mutating func checkIn(gym: String, enteredAt: Date, id: String = UUID().uuidString) {
        enqueue(GeofenceEvent(id: id, kind: .enter, gym: gym, at: enteredAt))
    }

    /// The gym's coordinates were cleared: its parked exit means nothing now.
    /// Queued events stay — they are facts already.
    mutating func clearGym(_ gym: String) {
        pendingExits.removeValue(forKey: gym)
    }

    // MARK: Sending

    /// The one event to send now: the oldest.
    func next() -> GeofenceEvent? { outbox.first }

    /// The server answered `action` for `event`.
    mutating func answered(_ event: GeofenceEvent, action: String, now: Date) {
        outbox.removeAll { $0.id == event.id }
        if event.kind == .enter && action == "created" {
            // The late tap: exits already answered "none" for this gym, after
            // this entry, are what closes the visit just opened.
            let back = maybeLater.filter { $0.gym == event.gym && $0.at > event.at }
            maybeLater.removeAll { e in back.contains { $0.id == e.id } }
            for e in back { enqueue(e) }
        } else if event.kind == .exit && action == "none" {
            var kept = event
            if kept.firstNoneAt == nil { kept.firstNoneAt = now }
            maybeLater.removeAll { $0.id == kept.id }
            maybeLater.append(kept)
        }
    }

    /// The server refused the event as malformed (4xx): drop it, or it would
    /// block every later event for good.
    mutating func rejected(_ event: GeofenceEvent) {
        outbox.removeAll { $0.id == event.id }
    }

    /// Oldest first by event time; an enter before an exit at the same
    /// instant. The same event twice (two taps on one prompt) is kept once.
    private mutating func enqueue(_ e: GeofenceEvent) {
        if outbox.contains(where: { $0.kind == e.kind && $0.gym == e.gym && $0.at == e.at }) { return }
        outbox.append(e)
        outbox.sort { a, b in
            if a.at != b.at { return a.at < b.at }
            return a.kind == .enter && b.kind == .exit
        }
    }

    // MARK: Wire format and persistence

    static func requestBody(_ e: GeofenceEvent) -> [String: String] {
        ["event": e.kind.rawValue, "gym": e.gym, "atISO": isoString(e.at)]
    }

    static func isoString(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: d)
    }

    static func date(fromISO s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    static func decode(_ data: Data) -> GeofenceQueue {
        (try? JSONDecoder().decode(GeofenceQueue.self, from: data)) ?? GeofenceQueue()
    }

    // MARK: The checked-out notification

    static let gymNames = ["bfit": "B_Fit", "work": "Alrajhi"]

    /// Same shape as fmtVisit on the web: "45 min", "1 h", "1 h 23".
    static func checkedOutText(gym: String, minutes: Int) -> String {
        let name = gymNames[gym] ?? gym
        let span: String
        if minutes < 60 {
            span = "\(minutes) min"
        } else {
            let m = minutes % 60
            span = m == 0 ? "\(minutes / 60) h" : "\(minutes / 60) h \(String(format: "%02d", m))"
        }
        return "Checked out of \(name) · \(span)"
    }

    /// Minutes of the visit the server returned with "closed".
    static func visitMinutes(_ visit: [String: Any]) -> Int? {
        guard let i = (visit["checkInAt"] as? String).flatMap(date(fromISO:)),
              let o = (visit["checkOutAt"] as? String).flatMap(date(fromISO:)) else { return nil }
        return max(0, Int((o.timeIntervalSince(i) / 60).rounded()))
    }
}
