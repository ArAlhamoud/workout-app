// SOURCE OF TRUTH. ios/App/App/GymGeofenceManager.swift is a copy the Xcode
// target compiles; `npm run ios:deploy` overwrites it from this file. Edit here.

import Foundation
import CoreLocation
import UserNotifications
import UIKit
import ObjectiveC

/// Automatic gym check-in/out (owner, 2026-10-22). docs/GYM-GEOFENCE.md.
///
/// Core Location REGION MONITORING, never continuous GPS: a 150 m circle and
/// a 600 m "away" circle around each gym he has set. The gym coordinates live
/// in UserDefaults on this phone and nowhere else; the server only ever hears
/// "enter/exit, which gym, when". No location is logged or kept.
///
/// Everything here runs without the webview: iOS relaunches a terminated app
/// in the BACKGROUND for a region event, with no scene and no bridge, so the
/// AppDelegate calls `launch` from didFinishLaunching and this object alone
/// takes the event, posts the prompt and sends the queue. The queue rules are
/// GymGeofenceCore (pure, tested); the visit rules are the server's (rule 9).
final class GymGeofence: NSObject, CLLocationManagerDelegate {
    static let shared = GymGeofence()

    static let gyms = ["bfit", "work"]
    static let smallRadius: CLLocationDistance = 150
    static let awayRadius: CLLocationDistance = 600
    /// A fix worse than this would put the circle in the wrong building.
    static let maxAccuracy: CLLocationAccuracy = 65
    static let imprecise = "GPS not precise enough — try again near the entrance"
    /// Approximate location cannot watch a 150 m circle (review D4).
    static let preciseOff = "Precise location off — turn it on in Settings"
    /// A fix older than this may be a cached one from elsewhere (review S3).
    static let freshFixAge: TimeInterval = 15

    private let defaults = UserDefaults.standard
    private let gymsKey = "gymGeofence.gyms"
    private let queueKey = "gymGeofence.queue"

    private var manager: CLLocationManager?
    private var queue = GeofenceQueue()

    // MARK: Launch

    /// Called from application(_:didFinishLaunchingWithOptions:) on EVERY
    /// launch, including the background relaunch for a region event
    /// (launchOptions[.location]); the delegate must exist before it returns.
    func launch(_ launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        guard manager == nil else { return }
        if launchOptions?[.location] != nil {
            NSLog("[GymGeofence] launched in the background for a region event")
        }
        if let data = defaults.data(forKey: queueKey) { queue = GeofenceQueue.decode(data) }
        GymNotifications.shared.install()
        let m = CLLocationManager()
        m.delegate = self
        manager = m
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        syncMonitoring()
        wake()
        #if DEBUG
        simulateFromLaunchArguments()
        #endif
    }

    @objc private func becameActive() { wake() }

    // MARK: Status for the web card

    var authorization: String {
        switch manager?.authorizationStatus ?? .notDetermined {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied, .restricted: return "denied"
        default: return "notDetermined"
        }
    }

    func status() -> [String: Any] {
        var set: [String: Any] = [:]
        for g in Self.gyms where storedGyms[g] != nil { set[g] = ["set": true] }
        let ours = (manager?.monitoredRegions ?? []).contains { $0.identifier.hasPrefix("gym.small.") }
        return ["authorization": authorization, "gyms": set, "monitoring": ours, "reducedAccuracy": reducedAccuracy]
    }

    private var reducedAccuracy: Bool {
        manager?.accuracyAuthorization == .reducedAccuracy
    }

    // MARK: Permission: When-In-Use first, then Always
    //
    // On iOS 27 neither prompt resigns the app, and "Keep Only While Using"
    // reports no change at all (simulator, 2026-10-22), so there is no moment
    // to wait for: requestAlways resolves once the Always prompt is up (or the
    // answer is final), and every authorization change reaches the card as a
    // "statusChange" event (onStatusChange, wired by the plugin).

    /// Set by the plugin while the webview exists; never needed for events.
    var onStatusChange: (() -> Void)?
    private var authWaiters: [(String) -> Void] = []
    private var alwaysAfterWhenInUse = false

    func requestAlways(_ done: @escaping (String) -> Void) {
        guard let m = manager else { return done("notDetermined") }
        switch m.authorizationStatus {
        case .notDetermined:
            authWaiters.append(done)
            alwaysAfterWhenInUse = true
            m.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            m.requestAlwaysAuthorization()
            done(authorization)
        default:
            done(authorization)
        }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        NSLog("[GymGeofence] authorization now %@", authorization)
        syncMonitoring()
        if alwaysAfterWhenInUse && m.authorizationStatus != .notDetermined {
            alwaysAfterWhenInUse = false
            if m.authorizationStatus == .authorizedWhenInUse { m.requestAlwaysAuthorization() }
            let a = authorization
            let w = authWaiters
            authWaiters = []
            w.forEach { $0(a) }
        }
        onStatusChange?()
    }

    // MARK: Setting a gym — one fix, standing at it

    private var storedGyms: [String: [String: Double]] {
        get { defaults.dictionary(forKey: gymsKey) as? [String: [String: Double]] ?? [:] }
        set { defaults.set(newValue, forKey: gymsKey) }
    }

    private var fixWaiter: ((CLLocation?, String?) -> Void)?
    private var fixToken = 0

    func setGym(_ gym: String, done: @escaping (_ accuracyM: Int?, _ error: String?) -> Void) {
        guard Self.gyms.contains(gym) else { return done(nil, "Unknown gym") }
        guard let m = manager, m.authorizationStatus == .authorizedAlways else {
            return done(nil, "Allow location Always first")
        }
        guard m.accuracyAuthorization == .fullAccuracy else { return done(nil, Self.preciseOff) }
        guard fixWaiter == nil else { return done(nil, "Already finding your location") }
        fixWaiter = { [weak self] loc, err in
            guard let self else { return }
            guard let loc else { return done(nil, err ?? "Could not get your location — try again") }
            let acc = loc.horizontalAccuracy
            guard acc >= 0, acc <= Self.maxAccuracy else { return done(Int(acc.rounded()), Self.imprecise) }
            var all = self.storedGyms
            all[gym] = ["lat": loc.coordinate.latitude, "lon": loc.coordinate.longitude]
            self.storedGyms = all
            self.syncMonitoring()
            self.onStatusChange?()
            NSLog("[GymGeofence] %@ set (±%d m)", gym, Int(acc.rounded()))
            done(Int(acc.rounded()), nil)
        }
        fixToken += 1
        let token = fixToken
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.requestLocation()
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.fixToken == token else { return }
            self.finishFix(nil, "Could not get your location — try again")
        }
    }

    private func finishFix(_ loc: CLLocation?, _ err: String?) {
        guard let w = fixWaiter else { return }
        fixWaiter = nil
        fixToken += 1
        w(loc, err)
    }

    /// Only a fresh fix sets a gym: requestLocation can hand back a cached
    /// one from somewhere else. A stale one asks again (the 20 s timeout and
    /// its plain error still stand).
    func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard fixWaiter != nil else { return }
        guard let loc = locations.last(where: { abs($0.timestamp.timeIntervalSinceNow) <= Self.freshFixAge }) else {
            m.requestLocation()
            return
        }
        finishFix(loc, nil)
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        finishFix(nil, "Could not get your location — try again")
    }

    func clearGym(_ gym: String) {
        var all = storedGyms
        all.removeValue(forKey: gym)
        storedGyms = all
        queue.clearGym(gym)
        save()
        syncMonitoring()
        NSLog("[GymGeofence] %@ cleared", gym)
    }

    // MARK: Regions

    /// Monitor exactly the circles of the gyms that are set, and only with
    /// Always (When-In-Use cannot wake a closed app: everything stays manual).
    private func syncMonitoring() {
        guard let m = manager else { return }
        let allowed = m.authorizationStatus == .authorizedAlways
            && m.accuracyAuthorization == .fullAccuracy
            && CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        var wanted: [String: CLCircularRegion] = [:]
        if allowed {
            for (gym, c) in storedGyms {
                guard let lat = c["lat"], let lon = c["lon"] else { continue }
                let center = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                let small = CLCircularRegion(center: center, radius: Self.smallRadius, identifier: "gym.small.\(gym)")
                small.notifyOnEntry = true
                small.notifyOnExit = true
                let away = CLCircularRegion(center: center, radius: Self.awayRadius, identifier: "gym.away.\(gym)")
                away.notifyOnEntry = false
                away.notifyOnExit = true
                wanted[small.identifier] = small
                wanted[away.identifier] = away
            }
        }
        for r in m.monitoredRegions where r.identifier.hasPrefix("gym.") {
            // Within a metre, not exact doubles: a region read back need not
            // round-trip, and a needless restart loses inside/outside (S2).
            if let w = wanted[r.identifier], let c = r as? CLCircularRegion,
               GeofenceQueue.sameCircle(c.center.latitude, c.center.longitude, c.radius,
                                        w.center.latitude, w.center.longitude, w.radius) {
                wanted.removeValue(forKey: r.identifier)
            } else {
                m.stopMonitoring(for: r)
            }
        }
        for r in wanted.values { m.startMonitoring(for: r) }
    }

    private func parse(_ region: CLRegion) -> (small: Bool, gym: String)? {
        let parts = region.identifier.split(separator: ".")
        guard parts.count == 3, parts[0] == "gym", Self.gyms.contains(String(parts[2])) else { return nil }
        return (parts[1] == "small", String(parts[2]))
    }

    func locationManager(_ m: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let (small, gym) = parse(region), small else { return }
        enteredGym(gym, at: Date())
    }

    func locationManager(_ m: CLLocationManager, didExitRegion region: CLRegion) {
        guard let (small, gym) = parse(region) else { return }
        exited(gym, small: small, at: Date())
    }

    /// Region events carry no timestamp: delivery is the moment. The wake
    /// runs FIRST (review D1); its region-state asks answer asynchronously,
    /// so the entry below always sees — and sends — an old pending exit.
    private func enteredGym(_ gym: String, at: Date) {
        wake()
        let prompt = queue.enteredGym(gym, at: at)
        save()
        NSLog("[GymGeofence] entered %@ (prompt: %@)", gym, prompt ? "yes" : "no — same stay")
        if prompt { GymNotifications.shared.postArrival(gym: gym, enteredAt: at) }
        drain()
    }

    /// Gyms whose state we asked about (a due pending exit). Only those
    /// answers count: iOS also reports state on every transition.
    private var stateAsked: Set<String> = []

    func locationManager(_ m: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        guard let (small, gym) = parse(region), small, stateAsked.remove(gym) != nil else { return }
        let side: RegionSide = state == .inside ? .inside : state == .outside ? .outside : .unknown
        regionState(gym, side: side)
    }

    /// iOS's answer for a due pending exit (review D2): inside = drift,
    /// dropped; outside = sent with its original time; unknown = kept.
    private func regionState(_ gym: String, side: RegionSide) {
        queue.resolvePending(gym, side: side, now: Date())
        save()
        NSLog("[GymGeofence] %@ is %@", gym, side == .inside ? "inside — pending exit was drift" : side == .outside ? "outside" : "unknown — exit kept")
        drain()
    }

    private func exited(_ gym: String, small: Bool, at: Date) {
        if small {
            queue.exitedGym(gym, at: at)
            NSLog("[GymGeofence] left %@ — exit pending", gym)
        } else {
            queue.leftAwayArea(gym, now: at)
            NSLog("[GymGeofence] left the %@ area", gym)
        }
        save()
        wake()
    }

    #if DEBUG
    /// Simulator only. The iOS 27 simulator cannot monitor regions at all
    /// (isMonitoringAvailable is false; CLMonitor says conditionUnsupported),
    /// so a test feeds the SAME handlers through a launch argument:
    ///   xcrun simctl launch <sim> com.aralhamoud.workout -GymSimulate enter:bfit
    /// Steps: enter / exit (small circle) / away (600 m circle) / inside /
    /// outside / unknown (a region-state answer), comma-separated, each
    /// optionally "@-480" (seconds ago). Debug builds only.
    private func simulateFromLaunchArguments() {
        guard let script = defaults.string(forKey: "GymSimulate"), !script.isEmpty else { return }
        for step in script.split(separator: ",") {
            if step == "categories" {
                UNUserNotificationCenter.current().getNotificationCategories { cats in
                    NSLog("[GymGeofence] SIMULATED categories: %@", cats.map(\.identifier).sorted().joined(separator: ", "))
                }
                continue
            }
            let parts = step.split(separator: "@")
            let ev = parts[0].split(separator: ":")
            guard ev.count == 2, Self.gyms.contains(String(ev[1])) else { continue }
            let at = Date().addingTimeInterval(parts.count > 1 ? Double(parts[1]) ?? 0 : 0)
            let gym = String(ev[1])
            NSLog("[GymGeofence] SIMULATED %@ %@", String(ev[0]), gym)
            if ev[0] == "checkin" && parts.count > 1 {
                // An explicit entry time (seconds ago): the tap is now.
                checkIn(gym: gym, enteredAt: at) { NSLog("[GymGeofence] SIMULATED checkin done") }
                continue
            }
            if ev[0] == "checkin" {
                // What the Check in action does, fed the DELIVERED prompt's
                // userInfo (synthesized touches cannot open its actions).
                UNUserNotificationCenter.current().getDeliveredNotifications { list in
                    DispatchQueue.main.async {
                        guard let info = list.first(where: { $0.request.identifier == "gym.arrive.\(gym)" })?.request.content.userInfo,
                              let entered = (info["enteredAt"] as? String).flatMap(GeofenceQueue.date(fromISO:)) else {
                            return NSLog("[GymGeofence] SIMULATED checkin: no delivered prompt")
                        }
                        self.checkIn(gym: gym, enteredAt: entered) { NSLog("[GymGeofence] SIMULATED checkin done") }
                    }
                }
                continue
            }
            switch ev[0] {
            case "inside": regionState(gym, side: .inside)
            case "outside": regionState(gym, side: .outside)
            case "unknown": regionState(gym, side: .unknown)
            case "enter": enteredGym(gym, at: at)
            case "exit": exited(gym, small: true, at: at)
            case "away": exited(gym, small: false, at: at)
            default: break
            }
        }
    }
    #endif

    func locationManager(_ m: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        NSLog("[GymGeofence] monitoring failed for %@: %@", region?.identifier ?? "?", error.localizedDescription)
    }

    // MARK: Notification actions

    /// He tapped Check in. The core sends the entry time, or the tap time
    /// when the tap is far from it (review V1).
    func checkIn(gym: String, enteredAt: Date, done: @escaping () -> Void) {
        queue.checkIn(gym: gym, enteredAt: enteredAt, tappedAt: Date())
        save()
        NSLog("[GymGeofence] Check in tapped for %@", gym)
        wake(done)
    }

    // MARK: Sending — oldest first, one at a time, waiting for each answer

    private var sending = false
    private var drainWaiters: [() -> Void] = []
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    /// Every wake: forget stale kept exits, withdraw stale prompts, ask iOS
    /// where he is for each pending exit old enough to send (the answer
    /// decides, review D2), then send.
    func wake(_ done: (() -> Void)? = nil) {
        let now = Date()
        queue.wake(now: now)
        save()
        removeStalePrompts(now: now)
        for gym in queue.duePendingExits(now: now) {
            if let region = manager?.monitoredRegions.first(where: { $0.identifier == "gym.small.\(gym)" }) {
                stateAsked.insert(gym)
                manager?.requestState(for: region)
            }
        }
        if let done { drainWaiters.append(done) }
        drain()
    }

    /// A "Check in?" more than 30 min after the entry is withdrawn, so it
    /// cannot sit on the lock screen all day (review V1).
    private func removeStalePrompts(now: Date) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            let stale = list.filter { n in
                guard n.request.identifier.hasPrefix("gym.arrive."),
                      let entered = (n.request.content.userInfo["enteredAt"] as? String).flatMap(GeofenceQueue.date(fromISO:)) else { return false }
                return GeofenceQueue.promptExpired(enteredAt: entered, now: now)
            }.map(\.request.identifier)
            if !stale.isEmpty { center.removeDeliveredNotifications(withIdentifiers: stale) }
        }
    }

    private func drain() {
        guard !sending else { return }
        guard let event = queue.next(), let url = Self.endpoint else { return finishDrain() }
        sending = true
        if bgTask == .invalid {
            bgTask = UIApplication.shared.beginBackgroundTask(withName: "gym-visit") { [weak self] in
                self?.endBackgroundTask()
            }
        }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: GeofenceQueue.requestBody(event))
        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async { self.handle(event, data: data, response: response, error: error) }
        }.resume()
    }

    private func handle(_ event: GeofenceEvent, data: Data?, response: URLResponse?, error: Error?) {
        sending = false
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil, code == 200,
           let json = data.flatMap({ try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any],
           let action = json["action"] as? String {
            NSLog("[GymGeofence] %@ %@ → %@", event.kind.rawValue, event.gym, action)
            queue.answered(event, action: action, now: Date())
            save()
            if event.kind == .exit, action == "closed",
               let visit = json["visit"] as? [String: Any], let minutes = GeofenceQueue.visitMinutes(visit) {
                GymNotifications.shared.postCheckedOut(gym: event.gym, minutes: minutes)
            }
            return drain()
        }
        if error == nil, (400..<500).contains(code) {
            NSLog("[GymGeofence] %@ %@ refused (%d) — dropped", event.kind.rawValue, event.gym, code)
            queue.rejected(event)
            save()
            return drain()
        }
        // Offline or a server error: keep it; the next wake sends it again.
        NSLog("[GymGeofence] %@ %@ not sent (%@) — kept", event.kind.rawValue, event.gym, error?.localizedDescription ?? "HTTP \(code)")
        finishDrain()
    }

    private func finishDrain() {
        let w = drainWaiters
        drainWaiters = []
        w.forEach { $0() }
        endBackgroundTask()
    }

    private func endBackgroundTask() {
        guard bgTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(bgTask)
        bgTask = .invalid
    }

    private func save() {
        if let data = try? JSONEncoder().encode(queue) { defaults.set(data, forKey: queueKey) }
    }

    /// The shell's own server (capacitor.config.json, baked in by `cap copy`),
    /// so a simulator build pointed at a local mock sends there — never a
    /// hard-coded production URL.
    static let endpoint: URL? = {
        guard let file = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
              let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let server = json["server"] as? [String: Any],
              var base = server["url"] as? String, !base.isEmpty else { return nil }
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + "/api/gym/visit")
    }()
}

/// The arrival prompt and the checked-out line, and the notification
/// delegate that answers their actions without the webview.
///
/// Capacitor's bridge makes its NotificationRouter THE delegate when the view
/// loads. This object takes the gym notifications and forwards every other
/// one to whichever delegate it replaced, so rest timers and reminders behave
/// exactly as before. It installs at launch (background relaunches have no
/// bridge) and again from MainViewController.capacitorDidLoad, after the
/// bridge has installed its router.
final class GymNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = GymNotifications()

    static let arriveCategoryId = "GYM_ARRIVE"
    static let checkInAction = "GYM_CHECK_IN"
    static let notNowAction = "GYM_NOT_NOW"

    /// Background actions (empty options, not foreground): the tap is answered without
    /// opening the app, on the phone or on the Watch's mirrored copy.
    static let arriveCategory = UNNotificationCategory(
        identifier: arriveCategoryId,
        actions: [
            UNNotificationAction(identifier: checkInAction, title: "Check in", options: []),
            UNNotificationAction(identifier: notNowAction, title: "Not now", options: []),
        ],
        intentIdentifiers: [],
        options: []
    )

    /// The delegate this one wraps (Capacitor's router). Until it exists —
    /// a cold launch from a notification tap — non-gym calls are HELD and
    /// replayed when it is wrapped, never completed early (review S1).
    private let gate = ReplayGate<NSObject>()

    func install() {
        Self.installCategoryGuard()
        let center = UNUserNotificationCenter.current()
        // Re-read inside the lock: a set made after this read already went
        // through the guard (gym category included), so ours would only be
        // stale and could drop the rest timer's category (review S5).
        let version = Self.categoryVersion
        center.getNotificationCategories { existing in
            Self.categoryLock.lock()
            defer { Self.categoryLock.unlock() }
            if Self.categoryVersion == version { center.setNotificationCategories(existing) }
        }
        if center.delegate === self { return }
        if let current = center.delegate as? NSObject { gate.attach(current) }
        center.delegate = self
    }

    /// Every category set, ours or the LocalNotifications plugin's, runs
    /// under this lock and bumps the version.
    static let categoryLock = NSRecursiveLock()
    static var categoryVersion = 0

    // The LocalNotifications plugin's registerActionTypes (the rest timer's
    // "+30 s / Done") REPLACES the whole category set, which would strip
    // Check in / Not now from a prompt already on the lock screen. Every set
    // goes through this guard, which keeps the gym category in.
    private static var guardInstalled = false
    private static func installCategoryGuard() {
        guard !guardInstalled else { return }
        guardInstalled = true
        let cls: AnyClass = UNUserNotificationCenter.self
        guard let original = class_getInstanceMethod(cls, #selector(UNUserNotificationCenter.setNotificationCategories(_:))),
              let guarded = class_getInstanceMethod(cls, #selector(UNUserNotificationCenter.gym_setNotificationCategories(_:))) else { return }
        method_exchangeImplementations(original, guarded)
    }

    func postArrival(gym: String, enteredAt: Date) {
        let c = UNMutableNotificationContent()
        c.body = "At \(GeofenceQueue.gymNames[gym] ?? gym). Check in?"
        c.categoryIdentifier = Self.arriveCategoryId
        c.sound = .default
        c.userInfo = ["gymGeofence": "arrive", "gym": gym, "enteredAt": GeofenceQueue.isoString(enteredAt)]
        post(id: "gym.arrive.\(gym)", c)
    }

    func postCheckedOut(gym: String, minutes: Int) {
        let c = UNMutableNotificationContent()
        c.body = GeofenceQueue.checkedOutText(gym: gym, minutes: minutes)
        c.sound = nil
        c.userInfo = ["gymGeofence": "checkout", "gym": gym]
        post(id: "gym.checkout.\(gym)", c)
    }

    private func post(id: String, _ content: UNNotificationContent) {
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { err in
            if let err { NSLog("[GymGeofence] notification failed: %@", err.localizedDescription) }
        }
    }

    private static func isGym(_ n: UNNotification) -> Bool {
        n.request.content.userInfo["gymGeofence"] != nil
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if Self.isGym(notification) {
            let arrive = notification.request.content.categoryIdentifier == Self.arriveCategoryId
            return completionHandler(arrive ? [.banner, .list, .sound] : [.banner, .list])
        }
        let done = completionHandler
        gate.send { next in
            let d = next as? UNUserNotificationCenterDelegate
            if d?.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: done) == nil { done([]) }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        guard Self.isGym(response.notification) else {
            let done = completionHandler
            gate.send { next in
                let d = next as? UNUserNotificationCenterDelegate
                if d?.userNotificationCenter?(center, didReceive: response, withCompletionHandler: done) == nil { done() }
            }
            return
        }
        if response.actionIdentifier == Self.checkInAction,
           let gym = info["gym"] as? String,
           let entered = (info["enteredAt"] as? String).flatMap(GeofenceQueue.date(fromISO:)) {
            GymGeofence.shared.checkIn(gym: gym, enteredAt: entered, done: completionHandler)
        } else {
            // Not now, a dismissal, or a plain tap: nothing to report, but a
            // wake is a chance to send what is due.
            GymGeofence.shared.wake(completionHandler)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?) {
        gate.send { next in (next as? UNUserNotificationCenterDelegate)?.userNotificationCenter?(center, openSettingsFor: notification) }
    }
}

extension UNUserNotificationCenter {
    /// Swapped with setNotificationCategories(_:) by the guard above: calling
    /// this name runs the ORIGINAL setter.
    @objc func gym_setNotificationCategories(_ categories: Set<UNNotificationCategory>) {
        GymNotifications.categoryLock.lock()
        defer { GymNotifications.categoryLock.unlock() }
        GymNotifications.categoryVersion += 1
        var merged = categories.filter { $0.identifier != GymNotifications.arriveCategoryId }
        merged.insert(GymNotifications.arriveCategory)
        gym_setNotificationCategories(merged)
    }
}
