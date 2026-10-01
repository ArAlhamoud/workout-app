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

    /// `gym` matters (rule 2): the prescription, pins and crown step are the
    /// building's own. A session continued from the phone asks for the
    /// phone's gym; one started here is B_Fit.
    static func fetchPlan(day: String?, dur: Int?, gym: String? = nil) async throws -> Plan {
        try await fetchPlanChecked(day: day, dur: dur, gym: gym).plan
    }

    /// The plan, and the days banked on this wrist at any point WHILE it was
    /// fetched — read before the request and again after it, because the
    /// flush runs alongside: a session that lands mid-fetch leaves an empty
    /// outbox behind a plan the server computed without it
    /// (SessionCore.queuePlanStale).
    static func fetchPlanChecked(day: String?, dur: Int?, gym: String? = nil) async throws -> (plan: Plan, banked: [String]) {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/watch/plan"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if let day { items.append(URLQueryItem(name: "day", value: day)) }
        if let dur { items.append(URLQueryItem(name: "dur", value: String(dur))) }
        if let gym { items.append(URLQueryItem(name: "gym", value: gym)) }
        if !items.isEmpty { comps.queryItems = items }
        let before = Outbox.bankedDays()
        let (data, resp) = try await session.data(from: comps.url!)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let plan = try JSONDecoder().decode(Plan.self, from: data)
        let banked = before + Outbox.bankedDays()
        // `queue`: no day was asked, so the server's queue chose this one —
        // the only kind of plan an offline Action Button may start from.
        Store.savePlanCache(plan, gym: gym, queue: day == nil, banked: banked)
        // Beside every queue plan, the other day's — so a day he picks by
        // name has a plan to open with no signal (SessionCore.companionDay).
        // Not awaited: a start never waits for it.
        if day == nil, let other = SessionCore.companionDay(for: plan, gym: gym) {
            Task { _ = try? await fetchPlan(day: other, dur: nil) }
        }
        return (plan, banked)
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

    enum PostResult: Equatable {
        /// 2xx. `deduped`: the server merged it into a workout it already had
        /// (the phone's, under the same save id) — a success, not an error.
        case delivered(deduped: Bool)
        /// The server read it and said no (400/413/422): it can never succeed.
        /// It is KEPT (the dead-letter file), never dropped as if saved.
        case rejected
        /// Try again later. `offline`: no answer at all, so the rest of the
        /// queue will fail too; a 5xx or a stray 4xx (Vercel 404, 408, 429)
        /// is about THIS attempt, so the next payload still gets its turn.
        case retry(offline: Bool)
    }

    /// Every other 4xx used to count as delivered — a Vercel 404 or a 429
    /// dropped a whole session behind a "Session saved" screen.
    static func postLog(_ payload: LogPayload) async -> PostResult {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/watch/log"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // An encode failure (a NaN weight) is a bug here, not a delivery:
        // keep the payload rather than pretend.
        guard let body = try? JSONEncoder().encode(payload) else { return .rejected }
        req.httpBody = body
        do {
            let (data, resp) = try await session.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if (200...299).contains(code) {
                let r = try? JSONDecoder().decode(LogResponse.self, from: data)
                return .delivered(deduped: r?.deduped == true)
            }
            if code == 400 || code == 413 || code == 422 { return .rejected }
            return .retry(offline: false)
        } catch {
            return .retry(offline: true)
        }
    }
}

/// The banked sessions — the ONLY writer of outbox.json and
/// outbox-rejected.json. An actor because a flush and a finish can overlap
/// (launch, Done, a wrist raise): the old flush held a snapshot across its
/// awaits and wrote it back, erasing a session banked meanwhile.
actor Outbox {
    static let shared = Outbox()
    /// The flush in progress. A second caller WAITS for it instead of
    /// returning at once with "nothing sent": a start that flushes before
    /// fetching the plan must not race past a flush the path monitor began.
    private var running: Task<Int, Never>?

    /// Bank a payload. false = the disk write failed: the caller must keep the
    /// session file, because nothing else holds these sets.
    func enqueue(_ payload: LogPayload) -> Bool {
        var box = Store.loadOutbox()
        if box.contains(where: { $0.clientSaveId == payload.clientSaveId }) { return true }
        box.append(payload)
        return Store.saveOutbox(box)
    }

    /// Kept forever, never retried: the server refused it. A Mac session can
    /// read the file; nothing deletes it.
    func deadLetter(_ payload: LogPayload) -> Bool {
        var dead = Store.loadRejected()
        if !dead.contains(where: { $0.clientSaveId == payload.clientSaveId }) { dead.append(payload) }
        return Store.saveRejected(dead)
    }

    /// Send what is banked, one flush at a time. The file is re-read after
    /// every await and entries are removed BY ID, so a payload banked while
    /// a send is in flight survives. Offline stops the loop; a 5xx moves on,
    /// so one bad payload never holds every later session hostage.
    @discardableResult
    func flush() async -> Int {
        if let running { return await running.value }
        let task = Task { await self.sendAll() }
        running = task
        let sent = await task.value
        running = nil
        return sent
    }

    private func sendAll() async -> Int {
        var sent = 0
        var tried = Set<String>()
        while let next = Store.loadOutbox().first(where: { !tried.contains($0.clientSaveId) }) {
            tried.insert(next.clientSaveId)
            let result = await API.postLog(next)
            switch result {
            case .delivered:
                sent += 1
                _ = Store.saveOutbox(Store.loadOutbox().filter { $0.clientSaveId != next.clientSaveId })
            case .rejected:
                if deadLetter(next) {
                    _ = Store.saveOutbox(Store.loadOutbox().filter { $0.clientSaveId != next.clientSaveId })
                }
            case .retry(let offline):
                if offline { return sent }
            }
        }
        return sent
    }

    /// For the Start screen, without awaiting the actor.
    nonisolated static func peekCounts() -> (pending: Int, rejected: Int) {
        (Store.loadOutbox().count, Store.loadRejected().count)
    }

    /// Save ids finished on this wrist but not yet on the server (banked or
    /// refused): their live rows are ours, never a phone session to continue.
    nonisolated static func bankedIds() -> Set<String> {
        Set((Store.loadOutbox() + Store.loadRejected()).map(\.clientSaveId))
    }

    /// The days of TODAY's sessions still waiting to upload: the server
    /// chose its queue without them (SessionCore.cacheVerdict /
    /// queuePlanStale). An older banked session no longer counts
    /// (SessionCore.bankedToday).
    nonisolated static func bankedDays() -> [String] {
        SessionCore.bankedToday(Store.loadOutbox(), now: Date())
    }
}

/// Tiny disk layer: plan cache, outbox, in-flight session. All JSON files in
/// the app container — UserDefaults is not trusted with the outbox because
/// these payloads are the training history itself.
enum Store {
    private static var dir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    /// The server's QUEUE plan for B_Fit (fetched with no day): what the
    /// Start screen shows and what an offline Action Button starts from.
    private static var planURL: URL { dir.appendingPathComponent("plan-cache.json") }
    /// The plans fetched for a NAMED day, a Continue, or another building —
    /// one per day and building. Kept apart: in the one file it replaced the
    /// queue plan, and the next offline start with no day opened it as if
    /// it were queued.
    private static var askedPlanURL: URL { dir.appendingPathComponent("plan-cache-asked.json") }
    private static var outboxURL: URL { dir.appendingPathComponent("outbox.json") }
    private static var sessionURL: URL { dir.appendingPathComponent("active-session.json") }
    private static var rejectedURL: URL { dir.appendingPathComponent("outbox-rejected.json") }

    /// Every write says whether it landed. `try?` everywhere meant a full
    /// disk looked exactly like a saved session — then the session file was
    /// deleted on the strength of it.
    @discardableResult
    private static func write(_ data: Data, to url: URL) -> Bool {
        do { try data.write(to: url, options: .atomic); return true } catch { return false }
    }

    /// A cached plan is usable for glances at any age, but too old to START
    /// a session: past this window a layoff may have begun and the server's
    /// ramp scaling must be consulted (trainer review, blocking).
    static let planStartWindow: TimeInterval = 7 * 86400

    static func savePlanCache(_ plan: Plan, gym: String? = nil, queue: Bool, banked: [String]) {
        let now = Date()
        // A queue plan fetched while a session of its day was banked here
        // is spent on arrival: the server chose the day without it.
        let spent = queue && banked.contains(plan.day)
        let cached = CachedPlan(plan: plan, fetchedAt: now, gym: gym, queue: queue, trainedAt: spent ? now : nil)
        if queue && (gym ?? "bfit") == "bfit" {
            if let d = try? JSONEncoder().encode(cached) { write(d, to: planURL) }
        } else {
            saveAsked(SessionCore.upsertCached(loadAsked(), cached))
        }
    }
    static func loadPlanCache() -> Plan? { loadQueueCache()?.plan }
    private static func loadQueueCache() -> CachedPlan? {
        guard let d = try? Data(contentsOf: planURL) else { return nil }
        return try? JSONDecoder().decode(CachedPlan.self, from: d)
    }
    private static func loadAsked() -> [CachedPlan] {
        guard let d = try? Data(contentsOf: askedPlanURL) else { return [] }
        return (try? JSONDecoder().decode([CachedPlan].self, from: d)) ?? []
    }
    private static func saveAsked(_ list: [CachedPlan]) {
        if let d = try? JSONEncoder().encode(list) { write(d, to: askedPlanURL) }
    }

    /// The cached plan that may open this start with no signal — or why
    /// none may (SessionCore.pickCached: too old to trust across a layoff,
    /// the wrong day or building, not the server's queue, a queue no build
    /// recorded, or a day already trained on this wrist).
    static func startable(day: String? = nil, gym: String? = nil) -> (plan: Plan?, why: SessionCore.CacheVerdict?) {
        let all = (loadQueueCache().map { [$0] } ?? []) + loadAsked()
        let pick = SessionCore.pickCached(all, day: day, gym: gym, bankedDays: Outbox.bankedDays(), now: Date())
        return (pick.cached?.plan, pick.why)
    }

    /// A session of `day` was finished on this wrist: a cached plan for that
    /// day is no longer the queue (SessionCore.markTrained). The next
    /// successful fetch replaces the plan and the mark with it.
    static func markPlanTrained(day: String) {
        let now = Date()
        if let c = loadQueueCache(), c.trainedAt == nil,
           let d = try? JSONEncoder().encode(SessionCore.markTrained(c, day: day, at: now)) {
            write(d, to: planURL)
        }
        let asked = loadAsked()
        if !asked.isEmpty { saveAsked(asked.map { $0.trainedAt == nil ? SessionCore.markTrained($0, day: day, at: now) : $0 }) }
    }

    @discardableResult
    static func saveSession(_ s: ActiveSession?) -> Bool {
        guard let s else {
            do { try FileManager.default.removeItem(at: sessionURL) } catch { return !FileManager.default.fileExists(atPath: sessionURL.path) }
            return true
        }
        guard let d = try? JSONEncoder().encode(s) else { return false }
        return write(d, to: sessionURL)
    }
    static func loadSession() -> ActiveSession? {
        guard let d = try? Data(contentsOf: sessionURL) else { return nil }
        return try? JSONDecoder().decode(ActiveSession.self, from: d)
    }

    static func loadOutbox() -> [LogPayload] {
        guard let d = try? Data(contentsOf: outboxURL) else { return [] }
        return (try? JSONDecoder().decode([LogPayload].self, from: d)) ?? []
    }
    /// Outbox only — callers go through `Outbox`, never here directly.
    @discardableResult
    static func saveOutbox(_ box: [LogPayload]) -> Bool {
        if box.isEmpty {
            do { try FileManager.default.removeItem(at: outboxURL) } catch { return !FileManager.default.fileExists(atPath: outboxURL.path) }
            return true
        }
        guard let d = try? JSONEncoder().encode(box) else { return false }
        return write(d, to: outboxURL)
    }
    static func loadRejected() -> [LogPayload] {
        guard let d = try? Data(contentsOf: rejectedURL) else { return [] }
        return (try? JSONDecoder().decode([LogPayload].self, from: d)) ?? []
    }
    @discardableResult
    static func saveRejected(_ box: [LogPayload]) -> Bool {
        guard let d = try? JSONEncoder().encode(box) else { return false }
        return write(d, to: rejectedURL)
    }
}
