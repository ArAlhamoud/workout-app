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
        NotificationCenter.default.addObserver(self, selector: #selector(resignedActive), name: UIApplication.willResignActiveNotification, object: nil)
        syncMonitoring()
        wake()
    }

    @objc private func becameActive() {
        wake()
        if !authWaiters.isEmpty {
            // Back from the system prompt. If he kept the same answer iOS
            // reports no change, so settle on what is true now.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.settleAuthWaiters() }
        }
    }

    @objc private func resignedActive() { promptSeen = true }

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
        return ["authorization": authorization, "gyms": set, "monitoring": ours]
    }

    // MARK: Permission: When-In-Use first, then Always

    private var authWaiters: [(String) -> Void] = []
    private var alwaysAfterWhenInUse = false
    private var promptSeen = false

    func requestAlways(_ done: @escaping (String) -> Void) {
        guard let m = manager else { return done("notDetermined") }
        switch m.authorizationStatus {
        case .notDetermined:
            authWaiters.append(done)
            alwaysAfterWhenInUse = true
            m.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            authWaiters.append(done)
            askAlways()
        default:
            done(authorization)
        }
    }

    private func askAlways() {
        promptSeen = false
        manager?.requestAlwaysAuthorization()
        // iOS shows the Always prompt once, ever. When it does not appear the
        // app never resigns active and no callback comes: settle anyway.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self, !self.promptSeen else { return }
            self.settleAuthWaiters()
        }
    }

    private func settleAuthWaiters() {
        // Still between the two prompts, or a system prompt is up: not yet.
        guard !alwaysAfterWhenInUse, UIApplication.shared.applicationState == .active else { return }
        let a = authorization
        let w = authWaiters
        authWaiters = []
        w.forEach { $0(a) }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        syncMonitoring()
        if alwaysAfterWhenInUse && m.authorizationStatus != .notDetermined {
            alwaysAfterWhenInUse = false
            if m.authorizationStatus == .authorizedWhenInUse {
                askAlways()
                return
            }
        }
        if m.authorizationStatus != .notDetermined && m.authorizationStatus != .authorizedWhenInUse {
            settleAuthWaiters()
        }
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

    func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        finishFix(locations.last, nil)
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
            if let w = wanted[r.identifier], let c = r as? CLCircularRegion,
               c.center.latitude == w.center.latitude, c.center.longitude == w.center.longitude, c.radius == w.radius {
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
        let now = Date()
        let prompt = queue.enteredGym(gym, at: now)
        save()
        NSLog("[GymGeofence] entered %@ (prompt: %@)", gym, prompt ? "yes" : "no — same stay")
        if prompt { GymNotifications.shared.postArrival(gym: gym, enteredAt: now) }
        wake()
    }

    func locationManager(_ m: CLLocationManager, didExitRegion region: CLRegion) {
        guard let (small, gym) = parse(region) else { return }
        let now = Date()
        if small {
            queue.exitedGym(gym, at: now)
            NSLog("[GymGeofence] left %@ — exit pending", gym)
        } else {
            queue.leftAwayArea(gym, now: now)
            NSLog("[GymGeofence] left the %@ area", gym)
        }
        save()
        wake()
    }

    func locationManager(_ m: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        NSLog("[GymGeofence] monitoring failed for %@: %@", region?.identifier ?? "?", error.localizedDescription)
    }

    // MARK: Notification actions

    /// He tapped Check in: report the moment he ENTERED (from the prompt).
    func checkIn(gym: String, enteredAt: Date, done: @escaping () -> Void) {
        queue.checkIn(gym: gym, enteredAt: enteredAt)
        save()
        NSLog("[GymGeofence] Check in tapped for %@", gym)
        wake(done)
    }

    // MARK: Sending — oldest first, one at a time, waiting for each answer

    private var sending = false
    private var drainWaiters: [() -> Void] = []
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    /// Every wake: release parked exits that are old enough, then send.
    func wake(_ done: (() -> Void)? = nil) {
        queue.wake(now: Date())
        save()
        if let done { drainWaiters.append(done) }
        drain()
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

    /// Background actions (no .foreground): the tap is answered without
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

    private weak var next: UNUserNotificationCenterDelegate?

    func install() {
        Self.installCategoryGuard()
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            center.setNotificationCategories(existing)
        }
        if center.delegate === self { return }
        next = center.delegate
        center.delegate = self
    }

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
        if next?.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler) == nil {
            completionHandler([])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        guard Self.isGym(response.notification) else {
            if next?.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler) == nil {
                completionHandler()
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
        next?.userNotificationCenter?(center, openSettingsFor: notification)
    }
}

extension UNUserNotificationCenter {
    /// Swapped with setNotificationCategories(_:) by the guard above: calling
    /// this name runs the ORIGINAL setter.
    @objc func gym_setNotificationCategories(_ categories: Set<UNNotificationCategory>) {
        var merged = categories.filter { $0.identifier != GymNotifications.arriveCategoryId }
        merged.insert(GymNotifications.arriveCategory)
        gym_setNotificationCategories(merged)
    }
}
