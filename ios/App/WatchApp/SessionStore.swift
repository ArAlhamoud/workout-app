import Foundation
import Network
import SwiftUI
import WatchKit

/// The session state machine: idle → active(set cards) → rest → RPE strip →
/// summary → done. Confirm/adjust only — the server already decided the
/// numbers. Every mutation is persisted immediately; a dead process resumes
/// exactly where the last set was logged (docs/WATCH.md offline rules).
///
/// WHAT a tap does to the session is SessionCore's (pure, tested on the Mac
/// by scripts/watch-core-tests). This class owns the rest: haptics, the rest
/// timer, the disk, the live row and the finish.
@MainActor
final class SessionStore: ObservableObject {
    /// How a finish ended — each one says something different on the Done
    /// screen. "Session saved" used to cover a banked, a refused and a lost
    /// session alike.
    enum DoneOutcome: Equatable {
        case saved
        /// The server merged it into the workout the phone already saved.
        case merged
        /// No signal: kept on the watch, sent when signal returns.
        case banked
        /// The server refused it: kept on the watch, never retried.
        case rejected
    }

    enum Phase: Equatable {
        case idle
        case loading
        case active
        case resting(until: Date)
        case rpePrompt(exerciseId: String, exerciseName: String)
        case summary
        case uploading
        case done(DoneOutcome)
    }

    @Published var phase: Phase = .idle
    @Published var plan: Plan?
    @Published var session: ActiveSession?
    @Published var pendingCount: Int = 0
    @Published var rejectedCount: Int = 0
    /// One-line notice on the Start screen (e.g. why a start was refused).
    @Published var notice: String?
    /// A session in progress on the PHONE (docs/WATCH.md "Live session"),
    /// offered on the Start screen as "Continue". nil = nothing to continue.
    @Published var phoneLive: LiveSession?
    /// A cached day the wrist could not confirm as the queue (a plan cached
    /// by an older build, no signal). The Start screen offers it BY NAME:
    /// the next tap on the big button asks for that day outright.
    @Published var offeredDay: String?

    let workout = WorkoutManager()
    /// How recently an EMPTY phone row must have been touched for the Action
    /// Button to treat it as the logger open in his hand.
    static let liveFreshWindow: TimeInterval = 30 * 60
    private var restTimer: Timer?
    private var launched = false
    private var isStarting = false
    private var finishing = false
    /// Signal coming back is a reason to send what is banked (onPath).
    private let pathMonitor = NWPathMonitor()
    /// How long a start waits for the banked sessions to land before it
    /// fetches the plan. A dead network answers at once; this bounds a slow
    /// one, so the Action Button is never held up by an upload.
    static let startFlushWait: TimeInterval = 4

    /// The session file loads HERE, synchronously, before anything else can
    /// run. It used to load in onLaunch (from .onAppear), so an Action Button
    /// press that reached start() first found no session and overwrote the
    /// one in progress with a fresh, empty one.
    init() {
        let s = Store.loadSession()
        session = s
        if let s { phase = Self.restoredPhase(s) }
        plan = Store.loadPlanCache()
        let c = Outbox.peekCounts()
        pendingCount = c.pending
        rejectedCount = c.rejected
    }

    /// Where a restored session resumes (SessionCore.restorePoint): the
    /// rating strip left unanswered, its summary, the rest still running,
    /// or the set card.
    private static func restoredPhase(_ s: ActiveSession) -> Phase {
        switch SessionCore.restorePoint(s, now: Date()) {
        case .rating(let id, let name): return .rpePrompt(exerciseId: id, exerciseName: name)
        case .summary: return .summary
        case .resting(let until): return .resting(until: until)
        case .active: return .active
        }
    }

    // MARK: - Launch

    /// Once per process: get a HealthKit session running again for a restored
    /// session, resume its rest countdown, flush banked payloads, and warm
    /// the plan and the live row.
    func onLaunch() {
        guard !launched else { return }
        launched = true
        if session != nil {
            // The HKWorkoutSession died with the process; get one running
            // again so the wrist behaves like a workout, not a launcher.
            // Never again once this session's workout was saved, and never
            // backdated past 3 h (rule 11).
            if let s = session, s.hkEnded != true {
                let begun = SessionCore.healthRestartStart(startedAt: s.startedAt, now: Date())
                Task { await workout.recoverOrBegin(startDate: begun) }
            }
            if case .resting(let until) = phase { scheduleRestEnd(until: until) }
        }
        // The outbox was flushed on launch, on a wrist raise and on Done
        // only: a session banked in a dead-signal gym waited for the next
        // time he opened the app, though the doc promised "on connectivity
        // restore". The monitor runs only while the process does — watchOS
        // suspends the app off-wrist; nothing here wakes it.
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in await self?.onPath(satisfied: satisfied) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "watch.path-monitor"))
        Task { await runForegroundSteps() }
    }

    /// Launch and wrist raise, in SessionCore.foregroundSteps' order: the
    /// live row before the upload, the queue plan after it.
    private func runForegroundSteps() async {
        for step in SessionCore.foregroundSteps(sessionActive: session != nil) {
            switch step {
            case .live: await refreshLive()
            case .flush: await flushOutbox()
            case .plan: await refreshPlan()
            }
        }
    }

    /// The server's queue plan, for the Start screen and the offline cache.
    /// It was fetched once per process, so a watch app left running showed —
    /// and started — the day it saw at launch. Now: launch, every
    /// foreground, and after a session reaches the server. Never during a
    /// session (the screen is not up, and the session has its own plan).
    func refreshPlan() async {
        guard session == nil else { return }
        guard let fresh = try? await API.fetchPlan(day: nil, dur: nil) else { return }
        // A session that began during the fetch keeps the plan it started on.
        guard session == nil else { return }
        plan = fresh
        offeredDay = nil
    }

    /// Send what is banked. Returns how many sessions reached the server.
    @discardableResult
    private func flushOutbox() async -> Int {
        let sent = await Outbox.shared.flush()
        refreshCounts()
        return sent
    }

    /// The network path changed. With signal and something banked: send it,
    /// then ask for the plan again — the queue just moved on.
    private func onPath(satisfied: Bool) async {
        guard SessionCore.flushOnPath(satisfied: satisfied, banked: Outbox.peekCounts().pending) else { return }
        if await flushOutbox() > 0 { await refreshPlan() }
    }

    /// Every start sends the banked sessions FIRST and waits for them, so
    /// the plan the server computes next includes them — it used to fetch
    /// straight away and get the day just trained, at pre-session weights.
    /// Bounded (startFlushWait): past it the flush carries on by itself and
    /// the start goes ahead; SessionCore.queuePlanStale then refuses a queue
    /// plan for a day that is still banked.
    private func flushBeforeStart() async {
        guard Outbox.peekCounts().pending > 0 else { return }
        let gate = StartGate()
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            gate.cont = cont
            Task { @MainActor in
                await Outbox.shared.flush()
                gate.open()
            }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(Self.startFlushWait))
                gate.open()
            }
        }
        refreshCounts()
    }

    /// Whichever comes first — the flush or the timeout — lets the start go on, once.
    @MainActor
    private final class StartGate {
        var cont: CheckedContinuation<Void, Never>?
        func open() {
            cont?.resume()
            cont = nil
        }
    }

    private func refreshCounts() {
        let c = Outbox.peekCounts()
        pendingCount = c.pending
        rejectedCount = c.rejected
    }

    /// Persist and publish. false = the disk refused (the card keeps working
    /// from memory; the next write tries again).
    @discardableResult
    private func commit(_ s: ActiveSession) -> Bool {
        session = s
        return Store.saveSession(s)
    }

    // MARK: - Live session (phone ↔ watch)

    /// Called on launch and whenever the app comes to the front. Two jobs:
    /// learn about a phone session to continue, and notice when OUR session
    /// was finished on the phone (row closed with a workout) — then the
    /// wrist copy is done too and must not be posted again.
    func refreshLive() async {
        if let s = session {
            guard !finishing else { return }
            guard let row = await API.fetchLive(id: s.clientSaveId) else { phoneLive = nil; return }
            // Re-read after the await: a set logged, or a finish begun, while
            // the fetch was in flight must not be overwritten by the snapshot.
            guard var cur = session, cur.clientSaveId == s.clientSaveId, !finishing else { return }
            if row.isClosed {
                if row.workoutId != nil {
                    await finishedOnPhone()
                } else {
                    // Discarded on the phone: its sets go, the wrist's stay.
                    SessionCore.dropPhoneSets(&cur, all: true)
                    commit(cur)
                }
            } else {
                SessionCore.merge(&cur, row: row)
                commit(cur)
                if cur.currentIndex >= cur.slots.count, case .active = phase { phase = .summary }
            }
            phoneLive = nil
            return
        }
        let row = await API.fetchLive()
        // A row whose finish is banked here is OUR finished session, not the
        // phone's work in progress (review F5).
        let banked = Outbox.bankedIds()
        phoneLive = (row?.source == "phone" && row?.isClosed == false && !banked.contains(row?.clientSaveId ?? "")) ? row : nil
    }

    /// Back on the wrist: learn what the phone did meanwhile FIRST — the
    /// upload used to come first and, on a slow or captive network, held
    /// the phone's sets back by up to 12 s a banked payload — then send
    /// what is banked, then (idle only) ask for the queue again: it may
    /// have moved since launch.
    func onForeground() async {
        await runForegroundSteps()
    }

    /// The phone finished this session. Anything logged HERE that the phone
    /// never saw rides a finish under the same id first — the server adds
    /// what the workout lacks — then this copy is done.
    private func finishedOnPhone() async {
        guard !finishing, let s0 = session else { return }
        finishing = true
        defer { finishing = false }
        stopRest()
        let uuid = await rememberWorkoutEnd()
        guard let s = session, s.clientSaveId == s0.clientSaveId else { return }
        let own = s.logged.filter { $0.origin != "phone" }
        var outcome: DoneOutcome = .merged
        if !own.isEmpty {
            var payload = buildPayload(s, uuid: uuid)
            payload.sets = own
            guard let o = await deliver(payload) else { keepAfterFailedSave(); return }
            outcome = (o == .saved) ? .merged : o
        }
        endSession(trained: s.day)
        phase = .done(outcome)
        WKInterfaceDevice.current().play(.success)
        Task { await refreshPlan() }
    }

    /// "Continue" on the Start screen: build the slots from the plan for the
    /// phone session's day, length and BUILDING, tick what the phone already
    /// logged, and carry on under the SAME save id so the finish merges into
    /// one workout. The HKWorkout is backdated to the phone's start.
    func continueLive(_ row: LiveSession) async {
        guard session == nil, !isStarting else { resumeExisting(); return }
        isStarting = true
        defer { isStarting = false }
        phase = .loading
        notice = nil
        await flushBeforeStart()
        var p = try? await API.fetchPlan(day: row.day, dur: row.durationMin, gym: row.gym)
        if p == nil { p = Store.startable(day: row.day, gym: row.gym).plan }
        guard session == nil else { resumeExisting(); return }
        guard let p, !p.exercises.isEmpty else {
            phase = .idle
            notice = "No plan yet — need signal once"
            return
        }
        plan = p
        let slots = SessionCore.buildSlots(p)
        // An empty row's start is only when the phone's page opened — never
        // backdate the workout (or Apple Health) to it (review F3).
        let begun = row.sets.isEmpty ? Date() : row.startedDate
        // The workout itself is backdated at most 3 h (rule 11); the session
        // keeps the phone's real start for its own timing.
        let hkStart = SessionCore.healthRestartStart(startedAt: begun, now: Date())
        var s = ActiveSession(
            clientSaveId: row.clientSaveId, day: row.day ?? p.day, rpeCap: p.rpeCap,
            startedAt: begun, slots: slots, currentIndex: 0, logged: [],
            gym: row.gym, planOrder: SessionCore.planOrder(slots),
            loadPct: p.loadPct, durationMin: row.durationMin ?? p.durationMin, warmupFirstN: p.warmupFirstN
        )
        SessionCore.merge(&s, row: row)
        commit(s)
        phoneLive = nil
        phase = s.currentIndex >= s.slots.count ? .summary : .active
        await workout.requestAuthorization()
        workout.begin(startDate: hkStart)
    }

    /// Every update goes to the live row as it happens, so the phone can take
    /// over mid-session. ONE post at a time, acknowledged in order
    /// (SessionCore.LiveQueue): parallel posts landed out of order on the
    /// server and a count-based ack dropped updates still in flight, so a
    /// rating or an undo could vanish from the row (review F1). The queue is
    /// kept on the session, so an update that never arrived is resent.
    private var liveQueue = LiveQueue()
    /// The session the queue belongs to: a late reply for an earlier session
    /// must never acknowledge entries of the current one.
    private var liveQueueFor: String?

    private func postLive(_ updates: [LiveUpdate]) {
        guard var s = session else { return }
        if liveQueueFor != s.clientSaveId {
            liveQueue = LiveQueue(s.unsentLive ?? [])
            liveQueueFor = s.clientSaveId
        }
        liveQueue.append(updates)
        s.unsentLive = liveQueue.pending
        commit(s)
        pumpLive(opening: updates.isEmpty)
    }

    /// Send the queue, one post at a time. `opening`: an empty post that only
    /// opens the row (session start) goes out even with nothing queued.
    private func pumpLive(opening: Bool = false) {
        guard let s = session, !liveQueue.isSending else { return }
        if liveQueueFor != s.clientSaveId { liveQueue = LiveQueue(s.unsentLive ?? []); liveQueueFor = s.clientSaveId }
        guard let batch = liveQueue.nextBatch(allowEmpty: opening) else { return }
        let id = s.clientSaveId
        // gym is nil on purpose: the OPENING device tagged the building and
        // the server keeps the first writer (rule 2).
        let post = LivePost(
            clientSaveId: id, source: "watch", day: s.day,
            durationMin: s.durationMin ?? plan?.durationMin, gym: nil,
            startedAt: ISO8601DateFormatter.fractional.string(from: s.startedAt),
            sets: batch
        )
        Task { [weak self] in
            let ok = await API.postLive(post) != nil
            guard let self, self.liveQueueFor == id else { return }
            if ok { self.liveQueue.ack(batch.count) } else { self.liveQueue.fail() }
            guard var cur = self.session, cur.clientSaveId == id else { return }
            cur.unsentLive = self.liveQueue.pending
            self.commit(cur)
            if ok, !self.liveQueue.pending.isEmpty { self.pumpLive() }
        }
    }

    private func liveUpdate(_ set: LogSet) -> LiveUpdate {
        SessionCore.liveUpdate(set, now: Date())
    }

    // MARK: - Start

    /// The Action Button: continue the PHONE's session when one is open —
    /// pressing it mid-session on the phone used to open a second session
    /// and close the phone's row, splitting one workout into two. The live
    /// row and the plan are fetched together. An open WATCH row with no
    /// session on this wrist is a banked finish, never something to continue.
    /// What is banked goes up first, so the plan fetched here includes it.
    func startFromButton() async {
        guard session == nil, !isStarting else { return }
        phase = .loading
        await flushBeforeStart()
        async let live = API.fetchLiveChecked()
        async let fresh = try? API.fetchPlanChecked(day: nil, dur: nil)
        let lookup = await live
        let row = lookup.live
        let p = await fresh
        if !SessionCore.buttonMayOpenNew(liveKnown: lookup.known, planFresh: p != nil) {
            // The Start screen, one tap from starting: his tap is the
            // decision the wrist could not make for him.
            guard session == nil else { resumeExisting(); return }
            if let p { plan = p.plan }
            offeredDay = nil
            notice = "Couldn't check the phone — tap to start"
            phase = .idle
            return
        }
        // A phone session with sets in it, or an open logger touched in the
        // last half hour (warm-ups and page opens push nothing) — never a row
        // left open hours ago when the page was merely visited (review F3),
        // and never our own banked finish (F5).
        if let row, row.source == "phone", !row.isClosed,
           !row.sets.isEmpty || Date().timeIntervalSince(row.updatedDate) < Self.liveFreshWindow,
           !Outbox.bankedIds().contains(row.clientSaveId) {
            await continueLive(row)
        } else {
            await start(day: nil, dur: nil, prefetched: p, fromButton: true)
        }
    }

    /// Start with whatever is best available: fresh plan if the network
    /// answers fast, cached plan otherwise.
    /// `promised`: the day the big button was showing when no day is asked
    /// — what opens must be what it read. `fromButton`: the Action Button,
    /// which starts with zero taps only on a training day.
    func start(day: String?, dur: Int?, prefetched: (plan: Plan, banked: [String])? = nil, promised: String? = nil, fromButton: Bool = false) async {
        guard session == nil, !isStarting else { resumeExisting(); return }
        isStarting = true
        defer { isStarting = false }
        phase = .loading
        notice = nil
        var fetched = prefetched
        if fetched == nil {
            await flushBeforeStart()
            fetched = try? await API.fetchPlanChecked(day: day, dur: dur)
        }
        var p = fetched?.plan
        if let f = fetched, day == nil {
            // A fresh queue plan is the server's word — three reasons not to
            // open it straight away, none of them a block:
            var held: String?
            if SessionCore.queuePlanStale(day: f.plan.day, bankedBefore: f.banked, bankedAfter: Outbox.bankedDays()) {
                // Signal, but today's banked session did not land (a slow
                // upload, a 5xx): the server queued this day without it.
                // Never repeat the day behind his back. The line states the
                // fact — done today — and invites nothing (trainer review).
                held = "Day \(f.plan.day) done today · not uploaded yet"
            } else if fromButton, !SessionCore.buttonStarts(mode: f.plan.mode) {
                // Recovery day, or already trained: the Start screen's own
                // banner says it; the big button goes ahead in one tap.
                held = ""
            } else if !SessionCore.promiseKept(shown: promised, opened: f.plan.day) {
                held = "Now Day \(f.plan.day) — tap to start"
            }
            if let held {
                guard session == nil else { resumeExisting(); return }
                plan = f.plan
                offeredDay = nil
                notice = held.isEmpty ? nil : held
                phase = .idle
                return
            }
        } else if p == nil {
            // Offline fallback — but NEVER from a cache old enough to span a
            // layoff, nor one for another day or building: a stale plan carries
            // pre-break weights with no ramp scaling (trainer review, blocking).
            // With no day asked, only the server's own queue plan, and not
            // once its day was trained here (SessionCore.cacheVerdict).
            let cached = Store.startable(day: day)
            p = cached.plan
            switch cached.why {
            case .ok?: break
            case .tooOld?: notice = "Plan too old — need signal once"
            case .trained?: notice = "Day \(plan?.day ?? "") done — need signal for the next plan"
            case .unconfirmed?:
                // The old build's cache: a plan IS on the wrist, only not
                // known to be the queue. Say so and offer it by name — it
                // read "No plan yet" with a valid plan on disk.
                if let d = Store.loadPlanCache()?.day {
                    offeredDay = d
                    notice = "No signal — tap again for Day \(d)"
                } else {
                    notice = "No plan yet — need signal once"
                }
            case .wrongPlan?, nil:
                notice = day.map { "No Day \($0) plan yet — need signal once" } ?? "No plan yet — need signal once"
            }
        }
        // A session that appeared during the await (a restore, a Continue)
        // wins: never overwrite it with a fresh one.
        guard session == nil else { resumeExisting(); return }
        guard let p, !p.exercises.isEmpty else { phase = .idle; return }
        plan = p
        offeredDay = nil
        let slots = SessionCore.buildSlots(p)
        let s = ActiveSession(
            clientSaveId: UUID().uuidString, day: p.day, rpeCap: p.rpeCap,
            startedAt: Date(), slots: slots, currentIndex: 0, logged: [],
            planOrder: SessionCore.planOrder(slots),
            loadPct: p.loadPct, durationMin: p.durationMin, warmupFirstN: p.warmupFirstN
        )
        guard commit(s) else {
            session = nil
            phase = .idle
            notice = "Watch storage full — can't start"
            return
        }
        phase = .active
        await workout.requestAuthorization()
        workout.begin()
        postLive([]) // open the live row so the phone can offer "Continue"
    }

    /// A session already exists: leave it where it stands — forcing .active
    /// would stomp a rest countdown or an unanswered rating strip.
    private func resumeExisting() {
        guard let s = session else { return }
        switch phase {
        case .idle, .loading: phase = Self.restoredPhase(s)
        default: break
        }
    }

    /// "2/6" for the card: which machine of TODAY'S PLAN is up — by plan
    /// order, NEVER by queue position (a rotation moves the current machine
    /// to the back, so a queue index would read 1/6 again right after a
    /// swipe). nil for a one-machine session, a session from before
    /// planOrder existed, or a machine the phone added.
    var machinePosition: (index: Int, total: Int)? {
        session.flatMap(SessionCore.machinePosition)
    }

    // MARK: - The set flow

    var currentSlot: SetSlot? {
        guard let s = session, s.currentIndex < s.slots.count else { return nil }
        return s.slots[s.currentIndex]
    }

    /// One crown move, relative to the current weight (SessionCore). A wall
    /// (0 or 500 kg) buzzes and changes nothing.
    func nudge(detents: Int) {
        guard detents != 0, var s = session, s.currentIndex < s.slots.count else { return }
        let slot = s.slots[s.currentIndex]
        if slot.isSeconds {
            let next = SessionCore.nudgedSeconds(slot, detents: detents)
            guard next != slot.reps else { WKInterfaceDevice.current().play(.failure); return }
            s.slots[s.currentIndex].reps = next
        } else {
            let next = SessionCore.nudgedWeight(slot, detents: detents)
            guard next != slot.weightKg else { WKInterfaceDevice.current().play(.failure); return }
            s.slots[s.currentIndex].weightKg = next
        }
        commit(s)
    }

    /// Tap on reps: +1, wrapping at repsMax (docs/WATCH.md screen 2).
    func cycleReps() {
        guard var s = session, s.currentIndex < s.slots.count else { return }
        s.slots[s.currentIndex].reps = SessionCore.cycledReps(s.slots[s.currentIndex])
        commit(s)
    }

    /// Long-press on reps: one fewer, down to 1 — a short set is recordable.
    func decrementReps() {
        guard var s = session, s.currentIndex < s.slots.count else { return }
        let next = SessionCore.decrementedReps(s.slots[s.currentIndex])
        guard next != s.slots[s.currentIndex].reps else { WKInterfaceDevice.current().play(.failure); return }
        s.slots[s.currentIndex].reps = next
        commit(s)
        WKInterfaceDevice.current().play(.directionDown)
    }

    func logCurrentSet() {
        // 0 kg is loggable but never accidental: the card's button turns
        // amber and says "Log bodyweight · 0 kg" — the phantom-zero worry
        // (rule 2) is answered by explicitness, not by a dead button that
        // once trapped the owner on his first real session.
        guard var s = session, let slot = currentSlot else { return }
        guard let set = SessionCore.log(&s, now: Date()) else { return }
        commit(s)
        WKInterfaceDevice.current().play(.click)
        postLive([liveUpdate(set)])
        if slot.isLastOfExercise {
            phase = .rpePrompt(exerciseId: slot.exerciseId, exerciseName: slot.exerciseName)
        } else {
            beginRest(after: slot)
        }
    }

    /// "skip warm-up" on a warm-up card: nothing logged, the working set is next.
    func skipWarmup() {
        guard var s = session, SessionCore.skipWarmup(&s) else { return }
        commit(s)
        WKInterfaceDevice.current().play(.directionDown)
    }

    /// RPE strip answer: one honest value on the set it describes — the
    /// last one — the rest left unrated. Cloning one tap onto every set
    /// inflated hardShare and corrupted the coach's per-set reads (trainer
    /// review). A rating below the cap on a machine that allows it opens
    /// the '+1 set' offer for the rest that follows (trainer ruling 2).
    func setRPE(_ rpe: Int, exerciseId: String) {
        guard var s = session else { return }
        let rated = SessionCore.rate(&s, exerciseId: exerciseId, rpe: rpe, now: Date())
        if rated != nil, rpe < s.rpeCap,
           s.slots.contains(where: { $0.exerciseId == exerciseId && $0.extraSetAllowed == true }),
           !(s.extraSetsTaken ?? []).contains(exerciseId) {
            s.extraSetOffer = exerciseId
        }
        commit(s)
        if let rated { postLive([liveUpdate(rated)]) }
        advanceAfterExercise()
    }

    /// "skip": the strip is answered — it must not come back on a relaunch.
    func skipRPE() {
        clearPendingRpe()
        advanceAfterExercise()
    }

    private func clearPendingRpe() {
        guard var s = session, s.pendingRpe != nil else { return }
        s.pendingRpe = nil
        commit(s)
    }

    private func advanceAfterExercise() {
        guard let s = session else { return }
        if s.currentIndex >= s.slots.count {
            phase = .summary
        } else if s.currentIndex > 0 {
            beginRest(after: s.slots[s.currentIndex - 1])
        } else {
            phase = .active
        }
    }

    /// The machine the '+1 set' offer is for, by name — nil when none is open.
    var extraSetOfferName: String? {
        guard let s = session, let id = s.extraSetOffer else { return nil }
        return s.slots.first { $0.exerciseId == id }?.exerciseName
    }

    /// '+1 set': the extra set is simply next — the rest keeps running.
    func addExtraSet() {
        guard var s = session, let id = s.extraSetOffer, SessionCore.addSet(&s, exerciseId: id) else { return }
        commit(s)
        WKInterfaceDevice.current().play(.click)
        if case .summary = phase { phase = .active }
    }

    /// The set this wrist could take back — named on the button.
    var undoableSet: LogSet? { session.flatMap(SessionCore.undoable) }

    /// Undo the last set THIS wrist logged, from the rest, rating or summary
    /// screen: the set leaves the log (and the live row), its card comes
    /// back at the logged weight and reps, and the rest stops.
    func undoLastSet() {
        guard var s = session, let set = SessionCore.undoLast(&s) else { return }
        s.restUntil = nil
        commit(s)
        stopRest()
        postLive([LiveUpdate(
            exerciseId: set.exerciseId, setNumber: set.setNumber, isWarmup: set.isWarmup,
            completedAt: ISO8601DateFormatter.fractional.string(from: Date()), remove: true
        )])
        phase = .active
        WKInterfaceDevice.current().play(.directionUp)
    }

    // MARK: - The Siri lane

    /// A spoken "done" (LogSetIntent): logs the card EXACTLY as it stands,
    /// through the same logCurrentSet the button uses, and leaves the set
    /// unrated (owner's rule, 2026-09-18). Only on a set card — never during
    /// a rest, a rating, the summary or with nothing running — and never a
    /// weighted card at 0 kg (the amber button's case). Voice never finishes,
    /// discards or undoes; the card stays the UI. Returns the spoken reply.
    func voiceLog() -> String {
        guard session != nil else { return "No workout running on the watch." }
        switch phase {
        case .active: break
        case .resting(let until):
            let left = max(0, Int(until.timeIntervalSinceNow.rounded()))
            return "Resting — \(left) seconds left."
        case .rpePrompt: return "Rate the last set on the watch first."
        case .summary: return "All sets are logged. Finish on the watch."
        default: return "Nothing to log right now."
        }
        guard let slot = currentSlot else { return "All sets are logged. Finish on the watch." }
        if !slot.isSeconds && slot.weightKg <= 0 { return "Set the weight on the watch first." }
        logCurrentSet()
        guard let set = session?.logged.last else { return "Couldn't log that." }
        if case .rpePrompt = phase { skipRPE() }
        var rest: Int?
        if case .resting(let until) = phase { rest = max(0, Int(until.timeIntervalSinceNow.rounded())) }
        return SessionCore.loggedLine(set, restSeconds: rest, next: currentSlot)
    }

    /// "What's next" (WhatsNextIntent): read-only, never writes.
    func voiceStatus() -> String {
        guard session != nil else { return "No workout running on the watch." }
        switch phase {
        case .resting(let until):
            let left = max(0, Int(until.timeIntervalSinceNow.rounded()))
            if let next = currentSlot { return "Resting, \(left) seconds left. Next: \(SessionCore.cardLine(next))" }
            return "Resting, \(left) seconds left."
        case .rpePrompt(_, let name): return "Rate \(name) on the watch."
        case .summary: return "All sets are logged. Finish on the watch."
        default:
            if let next = currentSlot { return SessionCore.cardLine(next) }
            return "All sets are logged. Finish on the watch."
        }
    }

    // MARK: - Occupied machine

    /// Machine taken? Rotate the PENDING exercise groups: the next machine's
    /// sets come up now and this machine's remaining sets go to the back of
    /// the queue. Nothing is logged or lost; the head never moves.
    func skipToNextMachine() { rotatePending(forward: true) }
    func backToPreviousMachine() { rotatePending(forward: false) }

    /// Number of distinct machines still holding pending sets — the card
    /// only advertises the swipe when there is somewhere to swipe to.
    var pendingMachineCount: Int {
        guard let s = session, s.currentIndex < s.slots.count else { return 0 }
        return Set(s.slots[s.currentIndex...].map(\.exerciseId)).count
    }

    /// The machine a forward switch would bring up — named on the card so
    /// the control is a real button, not a hidden gesture.
    var nextMachineName: String? {
        guard let s = session, s.currentIndex < s.slots.count else { return nil }
        let current = s.slots[s.currentIndex].exerciseId
        return s.slots[s.currentIndex...].first { $0.exerciseId != current }?.exerciseName
    }

    /// From the rest screen: the machine he is walking to is taken. Skip
    /// the rest and bring the next machine up in one tap.
    func switchMachineFromRest() {
        endRest()
        skipToNextMachine()
    }

    private func rotatePending(forward: Bool) {
        guard var s = session, SessionCore.rotate(&s, forward: forward) else {
            WKInterfaceDevice.current().play(.failure)
            return
        }
        commit(s)
        WKInterfaceDevice.current().play(forward ? .directionDown : .directionUp)
    }

    // MARK: - Rest

    /// Rest is programming, not a constant: 120 s after Leg Press is not
    /// 45 s after core, and a warm-up is followed by a short one. Saved on
    /// the session, so a relaunch resumes the countdown.
    private func beginRest(after slot: SetSlot) {
        guard var s = session else { return }
        guard s.currentIndex < s.slots.count else { phase = .summary; return }
        let until = Date().addingTimeInterval(TimeInterval(SessionCore.restSeconds(after: slot)))
        s.restUntil = until
        commit(s)
        phase = .resting(until: until)
        scheduleRestEnd(until: until)
    }

    private func scheduleRestEnd(until: Date) {
        restTimer?.invalidate()
        restTimer = Timer.scheduledTimer(withTimeInterval: max(0, until.timeIntervalSinceNow), repeats: false) { [weak self] _ in
            Task { @MainActor in
                // THIS rest, not merely some rest: an old timer must never end
                // a newer countdown early.
                guard let self, case .resting(let u) = self.phase, u == until else { return }
                WKInterfaceDevice.current().play(.notification)
                self.endRest()
            }
        }
    }

    private func stopRest() {
        restTimer?.invalidate()
        restTimer = nil
    }

    private func endRest() {
        stopRest()
        if var s = session, s.restUntil != nil {
            s.restUntil = nil
            commit(s)
        }
        phase = currentSlot == nil ? .summary : .active
    }

    func skipRest() { endRest() }

    /// "End": land on the summary from anywhere. Pending sets stay — the
    /// summary offers "Back to <machine>".
    func endEarly() {
        stopRest()
        clearPendingRpe()
        if var s = session, s.restUntil != nil {
            s.restUntil = nil
            commit(s)
        }
        phase = .summary
    }

    /// From the summary, back to the set card (nothing was ended).
    func backToSet() {
        guard currentSlot != nil else { return }
        phase = .active
    }

    // MARK: - Finish

    private func buildPayload(_ s: ActiveSession, uuid: String?) -> LogPayload {
        let fmt = ISO8601DateFormatter()
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US")
        df.dateFormat = "MMM d"
        let dayFmt = DateFormatter()
        dayFmt.locale = Locale(identifier: "en_US_POSIX")
        dayFmt.dateFormat = "yyyy-MM-dd" // wearer's local calendar day
        return LogPayload(
            day: s.day,
            name: "Day \(s.day) — Watch · \(df.string(from: s.startedAt))",
            startISO: fmt.string(from: s.startedAt),
            localDay: dayFmt.string(from: s.startedAt),
            durationSec: Int(Date().timeIntervalSince(s.startedAt)),
            gym: s.gym ?? "bfit",
            healthWorkoutUuid: uuid,
            clientSaveId: s.clientSaveId,
            sets: s.logged
        )
    }

    /// Send once; bank it on no answer, keep it in the dead-letter file on a
    /// refusal. nil = it could not be kept anywhere (the disk refused) — the
    /// caller must keep the session file, the only copy left.
    private func deliver(_ payload: LogPayload) async -> DoneOutcome? {
        switch await API.postLog(payload) {
        case .delivered(let deduped): return deduped ? .merged : .saved
        case .rejected: return await Outbox.shared.deadLetter(payload) ? .rejected : nil
        case .retry: return await Outbox.shared.enqueue(payload) ? .banked : nil
        }
    }

    /// End the HealthKit workout ONCE per session and remember it on disk:
    /// a session that survives its finish (a failed save, a killed process)
    /// keeps the uuid for the retry and never records a second workout on
    /// top of the first (rule 11).
    private func rememberWorkoutEnd() async -> String? {
        if let s = session, s.hkEnded == true { return s.hkWorkoutUuid }
        // Marked ended on disk BEFORE ending: a kill or a heart tap during
        // the save can never begin a second workout on top (the heart hides
        // on hkEnded). If the save then fails, Health simply lacks it, and
        // the phone's write fills the gap — never a duplicate.
        if var s = session {
            s.hkEnded = true
            commit(s)
        }
        let uuid = await workout.end()
        if var s = session {
            s.hkWorkoutUuid = uuid
            commit(s)
        }
        return uuid
    }

    private func keepAfterFailedSave() {
        notice = "Couldn't store the session — it's still on the watch"
        phase = .summary
        WKInterfaceDevice.current().play(.failure)
    }

    /// `trained`: the day just finished. Its cached plan is spent as the
    /// queue from this moment (rule 9's spirit: the wrist does not guess the
    /// next day, it only refuses to call the old one "queued"), and the
    /// Start screen goes back to the queue plan — not the explicit-day or
    /// Continue plan this session ran on.
    private func endSession(trained day: String) {
        stopRest()
        Store.saveSession(nil)
        session = nil
        Store.markPlanTrained(day: day)
        plan = Store.loadPlanCache() ?? plan
        refreshCounts()
    }

    func finish() async {
        guard !finishing, let s0 = session else { return }
        guard !s0.logged.isEmpty else { discard(); return }
        finishing = true
        defer { finishing = false }
        stopRest()
        phase = .uploading
        let uuid = await rememberWorkoutEnd()
        // Re-read: sets merged from the phone while HealthKit wrapped up
        // belong in the payload; a session replaced meanwhile is not ours.
        guard let s = session, s.clientSaveId == s0.clientSaveId else { return }
        guard let outcome = await deliver(buildPayload(s, uuid: uuid)) else { keepAfterFailedSave(); return }
        endSession(trained: s.day)
        phase = .done(outcome)
        WKInterfaceDevice.current().play(outcome == .saved || outcome == .merged ? .success : .directionUp)
        // The server has the session: its queue moved on, so ask again now —
        // the plan was fetched once per process and the Start screen kept
        // offering the day just trained. Banked: the path monitor's flush
        // asks when it lands.
        if outcome == .saved || outcome == .merged { Task { await refreshPlan() } }
    }

    /// Nothing worth keeping — no HKWorkout saved: abort() discards the
    /// recording so the phone's detect can't resurrect a session he
    /// deliberately threw away. The view asks first.
    func discard() {
        stopRest()
        workout.abort()
        if let id = session?.clientSaveId { Task { await API.closeLive(id: id) } }
        Store.saveSession(nil)
        session = nil
        plan = Store.loadPlanCache() ?? plan
        phase = .idle
    }

    func reset() {
        phase = .idle
        notice = nil
        Task { if await flushOutbox() > 0 { await refreshPlan() } }
    }
}
