import Foundation

/// The watch talks to the server directly over URLSession — never through
/// the phone; the whole point is the phone stays in the locker
/// (docs/WATCH.md). No auth: single user, the owner's standing decision.
enum API {
    static var baseURL: URL {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "WatchBaseURL") as? String) ?? ""
        return URL(string: raw.isEmpty ? "https://workout-app-gamma-rouge.vercel.app" : raw)!
    }

    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 12
        cfg.waitsForConnectivity = false // fail fast; the cache serves stale
        return URLSession(configuration: cfg)
    }()

    static func fetchPlan(day: String?, dur: Int?) async throws -> Plan {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/watch/plan"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if let day { items.append(URLQueryItem(name: "day", value: day)) }
        if let dur { items.append(URLQueryItem(name: "dur", value: String(dur))) }
        if !items.isEmpty { comps.queryItems = items }
        let (data, resp) = try await session.data(from: comps.url!)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let plan = try JSONDecoder().decode(Plan.self, from: data)
        Store.savePlanCache(plan)
        return plan
    }

    // MARK: Live session

    /// The open session on the server (either device), or with an id that
    /// row whatever its state. nil = nothing live, or no signal.
    static func fetchLive(id: String? = nil) async -> LiveSession? {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/live"), resolvingAgainstBaseURL: false)!
        if let id { comps.queryItems = [URLQueryItem(name: "id", value: id)] }
        guard let (data, resp) = try? await session.data(from: comps.url!),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let env = try? JSONDecoder().decode(LiveEnvelope.self, from: data) else { return nil }
        return env.live
    }

    /// Push logged sets (or the bare row, with no sets, when a session
    /// starts). Returns the merged row; a closed row means the other device
    /// finished. nil = no signal — nothing is lost, the finish carries all.
    @discardableResult
    static func postLive(_ post: LivePost) async -> LiveSession? {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/live"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let body = try? JSONEncoder().encode(post) else { return nil }
        req.httpBody = body
        guard let (data, resp) = try? await session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let env = try? JSONDecoder().decode(LiveEnvelope.self, from: data) else { return nil }
        return env.live
    }

    /// Discarded on the wrist: the phone must stop offering it.
    static func closeLive(id: String) async {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/live/close"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(["clientSaveId": id])
        _ = try? await session.data(for: req)
    }

    /// Returns true when the server accepted (or already had) the session.
    /// A 4xx means the payload can never succeed — treated as accepted so a
    /// poison payload cannot wedge the outbox forever.
    static func postLog(_ payload: LogPayload) async -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/watch/log"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let body = try? JSONEncoder().encode(payload) else { return true }
        req.httpBody = body
        do {
            let (_, resp) = try await session.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if (200...299).contains(code) { return true }
            if (400...499).contains(code) { return true } // poison — drop
            return false
        } catch {
            return false
        }
    }
}

/// Tiny disk layer: plan cache, outbox, in-flight session. All JSON files in
/// the app container — UserDefaults is not trusted with the outbox because
/// these payloads are the training history itself.
enum Store {
    private static var dir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    private static var planURL: URL { dir.appendingPathComponent("plan-cache.json") }
    private static var outboxURL: URL { dir.appendingPathComponent("outbox.json") }
    private static var sessionURL: URL { dir.appendingPathComponent("active-session.json") }

    /// A cached plan is usable for glances at any age, but too old to START
    /// a session: past this window a layoff may have begun and the server's
    /// ramp scaling must be consulted (trainer review, blocking).
    static let planStartWindow: TimeInterval = 7 * 86400

    static func savePlanCache(_ plan: Plan) {
        let cached = CachedPlan(plan: plan, fetchedAt: Date())
        if let d = try? JSONEncoder().encode(cached) { try? d.write(to: planURL, options: .atomic) }
    }
    static func loadPlanCache() -> Plan? { loadCachedPlan()?.plan }
    static func loadCachedPlan() -> CachedPlan? {
        guard let d = try? Data(contentsOf: planURL) else { return nil }
        return try? JSONDecoder().decode(CachedPlan.self, from: d)
    }
    /// Nil when offline AND the cache is too old to trust for a session.
    static func startablePlan() -> Plan? {
        guard let c = loadCachedPlan(), Date().timeIntervalSince(c.fetchedAt) < planStartWindow else { return nil }
        return c.plan
    }

    static func saveSession(_ s: ActiveSession?) {
        guard let s else { try? FileManager.default.removeItem(at: sessionURL); return }
        if let d = try? JSONEncoder().encode(s) { try? d.write(to: sessionURL, options: .atomic) }
    }
    static func loadSession() -> ActiveSession? {
        guard let d = try? Data(contentsOf: sessionURL) else { return nil }
        return try? JSONDecoder().decode(ActiveSession.self, from: d)
    }

    static func loadOutbox() -> [LogPayload] {
        guard let d = try? Data(contentsOf: outboxURL) else { return [] }
        return (try? JSONDecoder().decode([LogPayload].self, from: d)) ?? []
    }
    static func saveOutbox(_ box: [LogPayload]) {
        if box.isEmpty { try? FileManager.default.removeItem(at: outboxURL); return }
        if let d = try? JSONEncoder().encode(box) { try? d.write(to: outboxURL, options: .atomic) }
    }
    static func enqueue(_ payload: LogPayload) {
        var box = loadOutbox()
        // Same clientSaveId never queued twice (retry keeps the original).
        guard !box.contains(where: { $0.clientSaveId == payload.clientSaveId }) else { return }
        box.append(payload)
        saveOutbox(box)
    }

    /// Flush every banked session; called on finish, on launch, and when a
    /// send succeeds elsewhere. Keeps order; stops at the first hard failure.
    @discardableResult
    static func flushOutbox() async -> Int {
        var box = loadOutbox()
        var sent = 0
        while let next = box.first {
            guard await API.postLog(next) else { break }
            box.removeFirst()
            sent += 1
            saveOutbox(box)
        }
        return sent
    }
}
