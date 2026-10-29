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
///   Coming back cancels it when it may be drift; sends it when it is a
///   departure (`driftWindow`: confirmed, or older than 90 min).
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
    /// ONE rule for "drift or departure", used by every path (re-entry, the
    /// region-state answer, check-in bounding): a pending exit is CONFIRMED
    /// when the away circle was left or iOS answered "outside" for it; a
    /// confirmed exit is real. An unconfirmed one younger than this may be
    /// indoor GPS drift; older, it is a departure.
    static let driftWindow: TimeInterval = 90 * 60

    var outbox: [GeofenceEvent] = []
    var pendingExits: [String: Date] = [:]
    var maybeLater: [GeofenceEvent] = []
    /// Gyms whose pending exit iOS confirmed (answered "outside").
    var confirmedExits: Set<String> = []
    /// The stay a "Check in?" was already offered for, by when it began.
    /// Ended by a real exit (sent), or forgotten after `stayMemory`. The
    /// arrival backup asks only once per stay (owner, 2026-10-29: iOS sent
    /// no arrival at B_Fit for 30 min; opening the app now offers it).
    var promptedStays: [String: Date] = [:]
    /// Longer than a working day, so a whole day in the Alrajhi office tower
    /// is ONE stay: opening the app there asks at most once a day.
    static let stayMemory: TimeInterval = 14 * 3600

    init() {}

    private enum CodingKeys: String, CodingKey { case outbox, pendingExits, maybeLater, confirmedExits, promptedStays }

    /// Every key optional: a queue stored by an older or newer build keeps
    /// what it has instead of failing whole and wiping the outbox (review S4).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        outbox = try c.decodeIfPresent([GeofenceEvent].self, forKey: .outbox) ?? []
        pendingExits = try c.decodeIfPresent([String: Date].self, forKey: .pendingExits) ?? [:]
        maybeLater = try c.decodeIfPresent([GeofenceEvent].self, forKey: .maybeLater) ?? []
        confirmedExits = try c.decodeIfPresent(Set<String>.self, forKey: .confirmedExits) ?? []
        promptedStays = try c.decodeIfPresent([String: Date].self, forKey: .promptedStays) ?? [:]
    }

    /// The one rule: is this gym's pending exit a real departure?
    private func isDeparture(_ gym: String, exitAt: Date, now: Date) -> Bool {
        confirmedExits.contains(gym) || now.timeIntervalSince(exitAt) >= Self.driftWindow
    }

    /// Takes the pending exit off the books (sent or dropped).
    private mutating func takePending(_ gym: String) -> Date? {
        confirmedExits.remove(gym)
        return pendingExits.removeValue(forKey: gym)
    }

    private mutating func sendExit(_ gym: String, at exitAt: Date) {
        enqueue(GeofenceEvent(id: UUID().uuidString, kind: .exit, gym: gym, at: exitAt))
        promptedStays.removeValue(forKey: gym)
    }

    // MARK: Region events

    /// Entered a gym's small circle. True when the arrival prompt should be
    /// shown; false when this only cancels a pending exit (same stay).
    /// A departure (confirmed, or older than `driftWindow`) the app slept
    /// through is SENT, not deleted (review D1); an unconfirmed exit younger
    /// than that is drift and the same stay — no exit, no prompt (N1: the
    /// D1 fix had closed a real visit mid-workout on a drift re-entry).
    mutating func enteredGym(_ gym: String, at: Date) -> Bool {
        guard let exitAt = pendingExits[gym] else {
            // The backup already asked in this stay; iOS's own arrival came
            // late. One prompt per stay (review F3).
            if let began = promptedStays[gym], at.timeIntervalSince(began) < Self.stayMemory, at >= began { return false }
            promptedStays[gym] = at
            return true
        }
        let departure = isDeparture(gym, exitAt: exitAt, now: at)
        _ = takePending(gym)
        if departure { sendExit(gym, at: exitAt); promptedStays[gym] = at }
        return departure
    }

    /// The arrival backup: the app was opened and iOS says he is INSIDE
    /// `gym`'s small circle, but no arrival reached the app. True when
    /// "Check in?" should be offered now — once per stay: not while an exit
    /// is pending (that is the drift path's question), and not when this
    /// stay was already offered one.
    /// The server holds a visit open at ANOTHER gym: this ask did not
    /// count, the next open asks again (review F4).
    mutating func forgetStay(_ gym: String) {
        promptedStays.removeValue(forKey: gym)
    }

    mutating func insideOnOpen(_ gym: String, now: Date) -> Bool {
        guard pendingExits[gym] == nil else { return false }
        if let began = promptedStays[gym], now.timeIntervalSince(began) < Self.stayMemory { return false }
        promptedStays[gym] = now
        return true
    }

    /// Left a gym's small circle: park the exit. A repeated exit with no
    /// re-entry between keeps the first time.
    mutating func exitedGym(_ gym: String, at: Date) {
        if pendingExits[gym] == nil {
            pendingExits[gym] = at
            confirmedExits.remove(gym)
        }
    }

    /// Left the gym's 600 m area: he has really gone — send the parked exit
    /// with its small-circle time.
    mutating func leftAwayArea(_ gym: String, now: Date) {
        guard let exitAt = takePending(gym) else { return }
        sendExit(gym, at: exitAt)
    }

    /// Gyms whose pending exit is old enough to send — once iOS confirms he
    /// is outside. A wake alone never sends one: indoor drift fires a false
    /// exit while he trains, and the next foreground would close his real
    /// visit mid-workout (review D2).
    func duePendingExits(now: Date) -> [String] {
        pendingExits.filter { now.timeIntervalSince($0.value) >= Self.exitDelay }.map(\.key).sorted()
    }

    /// iOS answered where he is for `gym`'s small circle.
    /// Outside: the exit is CONFIRMED; sent once `exitDelay` old.
    /// Inside: drift if it is not a departure by the one rule (dropped);
    /// a departure and a return otherwise (sent — N2: yesterday's exit must
    /// not die because he opened the app at the gym today).
    /// Unknown: kept.
    mutating func resolvePending(_ gym: String, side: RegionSide, now: Date) {
        guard let exitAt = pendingExits[gym] else { return }
        switch side {
        case .outside:
            confirmedExits.insert(gym)
            if now.timeIntervalSince(exitAt) >= Self.exitDelay {
                _ = takePending(gym)
                sendExit(gym, at: exitAt)
            }
        case .inside:
            let departure = isDeparture(gym, exitAt: exitAt, now: now)
            _ = takePending(gym)
            if departure {
                // He is inside NOW. A departure older than the stay memory
                // (left yesterday) ends the stay; a younger one — indoor
                // drift at the Alrajhi tower past 90 min — must not re-open
                // "Check in?" at his desk (review F2).
                let kept = promptedStays[gym]
                sendExit(gym, at: exitAt)
                if let k = kept, now.timeIntervalSince(k) < Self.stayMemory { promptedStays[gym] = k }
            }
        case .unknown:
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
        // Only a real exit bounds the trip: sent or kept ones, or a confirmed
        // pending one — never an unconfirmed (possibly drift) pending exit (N3).
        let bounded = (outbox + maybeLater).contains { $0.kind == .exit && $0.gym == gym && $0.at > enteredAt }
            || (confirmedExits.contains(gym) && (pendingExits[gym].map { $0 > enteredAt } ?? false))
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
        _ = takePending(gym)
        promptedStays.removeValue(forKey: gym)
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

/// Region-state asks, stamped (review S-a): an answer counts only within
/// `window` of its ask, once; an enter/exit callback for that gym clears the
/// ask, so iOS's own transition report is never taken for our answer.
struct StateAsks {
    static let window: TimeInterval = 30
    private var asked: [String: Date] = [:]

    mutating func ask(_ gym: String, at: Date) { asked[gym] = at }

    mutating func accept(_ gym: String, at: Date) -> Bool {
        guard let t = asked.removeValue(forKey: gym) else { return false }
        return at.timeIntervalSince(t) >= 0 && at.timeIntervalSince(t) <= Self.window
    }

    mutating func clear(_ gym: String) { asked.removeValue(forKey: gym) }
}
