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

/// Where iOS says he is relative to a gym's small circle (requestState).
enum RegionSide { case inside, outside, unknown }

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
///   sent when he leaves the 600 m "away" area, or — once it is `exitDelay`
///   old — when iOS confirms he is OUTSIDE the small circle (the manager asks
///   on every wake; inside means the exit was drift and it is dropped).
///   Coming back within `exitDelay` cancels it; coming back later sends it.
/// - `outbox`: events to POST, oldest first, one at a time (the server's
///   contract). Survives offline and relaunch.
/// - `maybeLater`: exits the server answered "none". If he taps an old
///   "Check in?" after leaving, that enter is accepted, and these exits are
///   what closes the visit again; unused, they go after `maybeLaterWindow`.
struct GeofenceQueue: Codable, Equatable {
    static let exitDelay: TimeInterval = 7 * 60
    static let maybeLaterWindow: TimeInterval = 6 * 3600
    /// The entry time is trusted only for a tap this close to it (review V1:
    /// Alrajhi's circle fires on arrival at the office tower at 08:00).
    static let entryTrustWindow: TimeInterval = 30 * 60

    var outbox: [GeofenceEvent] = []
    var pendingExits: [String: Date] = [:]
    var maybeLater: [GeofenceEvent] = []

    init() {}

    private enum CodingKeys: String, CodingKey { case outbox, pendingExits, maybeLater }

    /// Every key optional: a queue stored by an older or newer build keeps
    /// what it has instead of failing whole and wiping the outbox (review S4).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        outbox = try c.decodeIfPresent([GeofenceEvent].self, forKey: .outbox) ?? []
        pendingExits = try c.decodeIfPresent([String: Date].self, forKey: .pendingExits) ?? [:]
        maybeLater = try c.decodeIfPresent([GeofenceEvent].self, forKey: .maybeLater) ?? []
    }

    // MARK: Region events

    /// Entered a gym's small circle. True when the arrival prompt should be
    /// shown; false when this only cancels a pending exit (same stay).
    /// A pending exit older than `exitDelay` was a real departure the app
    /// slept through: it is SENT, not deleted (review D1).
    mutating func enteredGym(_ gym: String, at: Date) -> Bool {
        guard let exitAt = pendingExits.removeValue(forKey: gym) else { return true }
        if at.timeIntervalSince(exitAt) >= Self.exitDelay {
            enqueue(GeofenceEvent(id: UUID().uuidString, kind: .exit, gym: gym, at: exitAt))
            return true
        }
        return false
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

    /// Gyms whose pending exit is old enough to send — once iOS confirms he
    /// is outside. A wake alone never sends one: indoor drift fires a false
    /// exit while he trains, and the next foreground would close his real
    /// visit mid-workout (review D2).
    func duePendingExits(now: Date) -> [String] {
        pendingExits.filter { now.timeIntervalSince($0.value) >= Self.exitDelay }.map(\.key).sorted()
    }

    /// iOS answered where he is for `gym`'s small circle. Inside: the pending
    /// exit was drift, dropped. Outside and old enough: sent with its
    /// original time. Unknown: kept.
    mutating func resolvePending(_ gym: String, side: RegionSide, now: Date) {
        guard let exitAt = pendingExits[gym] else { return }
        switch side {
        case .inside:
            pendingExits.removeValue(forKey: gym)
        case .outside where now.timeIntervalSince(exitAt) >= Self.exitDelay:
            pendingExits.removeValue(forKey: gym)
            enqueue(GeofenceEvent(id: UUID().uuidString, kind: .exit, gym: gym, at: exitAt))
        default:
            break
        }
    }

    /// Any wake: forget stale maybe-later exits.
    mutating func wake(now: Date) {
        maybeLater.removeAll { e in
            guard let first = e.firstNoneAt else { return true }
            return now.timeIntervalSince(first) > Self.maybeLaterWindow
        }
    }

    /// He tapped Check in on the arrival prompt. The ENTRY time when the tap
    /// is close to it; the TAP time when it is not (review V1: an 08:00
    /// arrival at the office tower tapped at 12:30 must not open a 4.5 h
    /// visit) — unless an exit after that entry is already known, which
    /// bounds the trip (the late tap after he left) and closes it at its
    /// real times.
    mutating func checkIn(gym: String, enteredAt: Date, tappedAt: Date, id: String = UUID().uuidString) {
        let bounded = (outbox + maybeLater).contains { $0.kind == .exit && $0.gym == gym && $0.at > enteredAt }
            || (pendingExits[gym].map { $0 > enteredAt } ?? false)
        let close = tappedAt.timeIntervalSince(enteredAt) <= Self.entryTrustWindow
        enqueue(GeofenceEvent(id: id, kind: .enter, gym: gym, at: close || bounded ? enteredAt : Swift.max(tappedAt, enteredAt)))
    }

    /// The arrival prompt is withdrawn this long after the entry.
    static func promptExpired(enteredAt: Date, now: Date) -> Bool {
        now.timeIntervalSince(enteredAt) > entryTrustWindow
    }

    /// Two circles are the same within a metre of centre and radius: Core
    /// Location does not hand coordinates back bit for bit (review S2).
    static func sameCircle(_ lat1: Double, _ lon1: Double, _ r1: Double,
                           _ lat2: Double, _ lon2: Double, _ r2: Double) -> Bool {
        guard abs(r1 - r2) <= 1 else { return false }
        let rad = Double.pi / 180
        let dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * rad) * cos(lat2 * rad) * sin(dLon / 2) * sin(dLon / 2)
        let metres = 2 * 6_371_000 * asin(Swift.min(1, sqrt(a)))
        return metres <= 1
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

/// Calls for a target that does not exist yet are HELD and replayed in order
/// once it is attached (review S1: a rest-timer or Gap Guard tap that cold-
/// launches the app arrives before Capacitor's notification router does; it
/// must wait for it, never be completed early). Main thread only.
final class ReplayGate<Target: AnyObject> {
    private weak var target: Target?
    private var held: [(Target) -> Void] = []

    func send(_ call: @escaping (Target) -> Void) {
        if let t = target { call(t) } else { held.append(call) }
    }

    func attach(_ t: Target) {
        target = t
        let calls = held
        held = []
        calls.forEach { $0(t) }
    }
}
