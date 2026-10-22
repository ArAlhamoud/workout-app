// The gym-geofence queue, tested on the Mac with plain swiftc —
// GymGeofenceCore is Foundation-only by design. Run: npm run test:geofence
import Foundation

var passed = 0, failed = 0
func check(_ cond: Bool, _ label: String) {
    if cond { passed += 1; print("  ok   \(label)") } else { failed += 1; print("  FAIL \(label)") }
}

// 2026-10-22, Riyadh (+03:00) clock times.
func at(_ hm: String) -> Date {
    let f = ISO8601DateFormatter()
    return f.date(from: "2026-10-22T\(hm):00+03:00")!
}
let min: TimeInterval = 60

print("Geofence core — the wire format")
do {
    let e = GeofenceEvent(id: "x", kind: .enter, gym: "bfit", at: at("17:00"))
    let body = GeofenceQueue.requestBody(e)
    check(body == ["event": "enter", "gym": "bfit", "atISO": "2026-10-22T14:00:00.000Z"], "the body is {event, gym, atISO} with the event time in UTC and a Z")
    check(GeofenceQueue.isoString(at("17:00")).hasSuffix("Z"), "atISO always carries Z")
    check(GeofenceQueue.date(fromISO: "2026-10-22T14:00:00.000Z") == at("17:00") && GeofenceQueue.date(fromISO: "2026-10-22T14:00:00Z") == at("17:00"), "times read back with or without fractions")
}

print("Geofence core — arriving")
do {
    var q = GeofenceQueue()
    check(q.enteredGym("bfit", at: at("17:00")) == true, "a fresh arrival asks 'Check in?'")
    check(q.outbox.isEmpty, "arriving sends nothing by itself — only a Check in tap does")
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:05"), id: "e1")
    check(q.next()?.kind == .enter && q.next()?.at == at("17:00"), "Check in queues an enter at the ENTRY time, not the tap time")
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:06"), id: "e2")
    check(q.outbox.count == 1, "a second tap on the same prompt queues nothing new")
}

print("Geofence core — leaving waits out drift")
do {
    var q = GeofenceQueue()
    _ = q.enteredGym("bfit", at: at("17:00"))
    q.exitedGym("bfit", at: at("18:30"))
    check(q.outbox.isEmpty && q.pendingExits["bfit"] == at("18:30"), "leaving the small circle parks a pending exit, sends nothing")
    check(q.duePendingExits(now: at("18:30").addingTimeInterval(6 * min)).isEmpty, "6 min after leaving nothing is due")
    q.resolvePending("bfit", side: .outside, now: at("18:30").addingTimeInterval(6 * min))
    check(q.outbox.isEmpty && q.pendingExits["bfit"] != nil, "even iOS saying 'outside' does not send it before 7 min")
    check(q.duePendingExits(now: at("18:30").addingTimeInterval(7 * min)) == ["bfit"], "7 min after leaving it is due: the manager asks iOS where he is")
    q.wake(now: at("18:30").addingTimeInterval(7 * min))
    check(q.outbox.isEmpty, "a wake alone never sends a pending exit (D2: it must ask the region state first)")
    q.resolvePending("bfit", side: .unknown, now: at("18:37"))
    check(q.outbox.isEmpty && q.pendingExits["bfit"] != nil, "state unknown: the exit stays pending")
    q.resolvePending("bfit", side: .outside, now: at("18:37"))
    check(q.next()?.kind == .exit && q.next()?.at == at("18:30") && q.pendingExits.isEmpty, "outside, 7 min on: the exit is sent at the ORIGINAL exit time")
}
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:30"))
    q.leftAwayArea("bfit", now: at("18:33"))
    check(q.next()?.kind == .exit && q.next()?.at == at("18:30"), "leaving the 600 m area sends the pending exit at once, with the small-circle time")
    q.leftAwayArea("work", now: at("18:34"))
    check(q.outbox.count == 1, "leaving an area with nothing pending sends nothing")
}
do {
    var q = GeofenceQueue()
    _ = q.enteredGym("bfit", at: at("17:00"))
    q.exitedGym("bfit", at: at("18:00"))
    let prompt = q.enteredGym("bfit", at: at("18:04"))
    check(q.pendingExits["bfit"] == nil, "coming back before it is sent cancels the pending exit (the car, GPS drift)")
    check(prompt == false, "and does not ask 'Check in?' a second time for the same stay")
    q.wake(now: at("19:00"))
    check(q.outbox.isEmpty, "a cancelled exit is never sent")
}
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:00"))
    q.exitedGym("bfit", at: at("18:02"))
    check(q.pendingExits["bfit"] == at("18:00"), "a repeated exit keeps the first exit time")
    q.exitedGym("work", at: at("18:01"))
    q.leftAwayArea("bfit", now: at("18:05"))
    check(q.outbox.count == 1 && q.pendingExits["work"] == at("18:01"), "one gym's away area never sends the other gym's exit")
    q.clearGym("work")
    check(q.pendingExits["work"] == nil, "clearing a gym drops its pending exit")
}

print("Geofence core — order and answers")
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:30"))
    q.leftAwayArea("bfit", now: at("18:40"))
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:10"), id: "late")
    check(q.next()?.kind == .enter, "events go oldest first: an enter at 17:00 before an exit at 18:30, whatever order they were queued")
    let enter = q.next()!
    q.answered(enter, action: "created", now: at("18:41"))
    check(q.next()?.kind == .exit && q.outbox.count == 1, "an answered event leaves the queue; the next one is the exit")
    let exit = q.next()!
    q.answered(exit, action: "closed", now: at("18:41"))
    check(q.outbox.isEmpty && q.maybeLater.isEmpty, "a closed exit is done")
}
do {
    // The late tap: he ignored the prompt, left (exit → none), then tapped Check in.
    var q = GeofenceQueue()
    _ = q.enteredGym("bfit", at: at("17:00"))
    q.exitedGym("bfit", at: at("18:30"))
    q.leftAwayArea("bfit", now: at("18:35"))
    let exit = q.next()!
    q.answered(exit, action: "none", now: at("18:35"))
    check(q.outbox.isEmpty && q.maybeLater.count == 1, "an exit answered 'none' is kept aside, not dropped")
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("19:10"), id: "late")
    let enter = q.next()!
    check(enter.kind == .enter && enter.at == at("17:00"), "the late enter is sent with the ENTRY time: an exit after it is already known, so the trip is bounded")
    q.answered(enter, action: "created", now: at("19:10"))
    check(q.next()?.kind == .exit && q.next()?.at == at("18:30") && q.maybeLater.isEmpty, "once the late enter is 'created', the kept exit is re-sent with its original time")
    let again = q.next()!
    q.answered(again, action: "none", now: at("19:11"))
    check(q.maybeLater.first?.firstNoneAt == at("18:35"), "a re-sent exit keeps the time of its FIRST 'none' (the 6 h clock does not restart)")
}
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("16:00"))
    q.leftAwayArea("bfit", now: at("16:10"))
    q.answered(q.next()!, action: "none", now: at("16:10"))
    q.exitedGym("work", at: at("18:00"))
    q.leftAwayArea("work", now: at("18:10"))
    q.answered(q.next()!, action: "none", now: at("18:10"))
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:05"), id: "e")
    q.answered(q.next()!, action: "created", now: at("18:20"))
    check(q.outbox.isEmpty && q.maybeLater.count == 2, "an enter re-sends only that gym's exits AFTER its entry time")
    q.checkIn(gym: "bfit", enteredAt: at("17:30"), tappedAt: at("17:35"), id: "e2")
    q.answered(q.next()!, action: "none", now: at("18:21"))
    check(q.outbox.isEmpty && q.maybeLater.count == 2, "an enter answered 'none' re-sends nothing")
}
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("10:00"))
    q.leftAwayArea("bfit", now: at("10:10"))
    q.answered(q.next()!, action: "none", now: at("10:10"))
    q.wake(now: at("16:09"))
    check(q.maybeLater.count == 1, "a kept exit survives just under 6 h")
    q.wake(now: at("16:11"))
    check(q.maybeLater.isEmpty, "an exit answered 'none' with no later enter is dropped after 6 h")
}
do {
    var q = GeofenceQueue()
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:01"), id: "bad")
    q.rejected(q.next()!)
    check(q.outbox.isEmpty, "an event the server refuses as malformed is dropped, so it cannot block the queue for good")
}

print("Geofence core — review fixes (2026-10-22)")
do {
    // V1: Alrajhi is in his office tower. Arrive at work 08:00, tap at 12:30.
    var q = GeofenceQueue()
    _ = q.enteredGym("work", at: at("08:00"))
    q.checkIn(gym: "work", enteredAt: at("08:00"), tappedAt: at("12:30"), id: "w")
    check(q.next()?.at == at("12:30"), "V1: a tap 4.5 h after the entry sends the TAP time, never 08:00")
    var q2 = GeofenceQueue()
    q2.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:30"), id: "b")
    check(q2.next()?.at == at("17:00"), "V1: a tap within 30 min trusts the entry time")
    var q3 = GeofenceQueue()
    q3.checkIn(gym: "bfit", enteredAt: at("17:00"), tappedAt: at("17:31"), id: "b")
    check(q3.next()?.at == at("17:31"), "V1: 31 min after the entry, the tap time")
    check(GeofenceQueue.promptExpired(enteredAt: at("17:00"), now: at("17:29")) == false && GeofenceQueue.promptExpired(enteredAt: at("17:00"), now: at("17:31")) == true, "V1: the arrival prompt expires 30 min after the entry")
}
do {
    // D1: left B_Fit, the away exit never fired, the app stayed suspended; back next day.
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:00"))
    let prompt = q.enteredGym("bfit", at: at("18:00").addingTimeInterval(24 * 3600))
    check(q.next()?.kind == .exit && q.next()?.at == at("18:00"), "D1: an old pending exit is SENT on re-entry (yesterday's visit closes at its real time), not deleted")
    check(prompt == true, "D1: and the new arrival asks 'Check in?'")
    var q2 = GeofenceQueue()
    q2.exitedGym("bfit", at: at("18:00"))
    check(q2.enteredGym("bfit", at: at("18:06")) == false && q2.outbox.isEmpty && q2.pendingExits.isEmpty, "D1: a pending exit younger than 7 min is still cancelled as drift")
}
do {
    // D2: indoor drift fires an exit at 18:30 while he trains; he opens the logger at 18:45.
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:30"))
    check(q.duePendingExits(now: at("18:45")) == ["bfit"], "D2: the wake finds it due and asks iOS")
    q.resolvePending("bfit", side: .inside, now: at("18:45"))
    check(q.outbox.isEmpty && q.pendingExits.isEmpty, "D2: iOS says inside: the exit was drift, dropped — the visit stays open")
    var q2 = GeofenceQueue()
    q2.exitedGym("bfit", at: at("18:30"))
    q2.resolvePending("bfit", side: .inside, now: at("18:31"))
    check(q2.pendingExits.isEmpty, "D2: inside right after the exit is drift too")
    q2.resolvePending("work", side: .outside, now: at("19:00"))
    check(q2.outbox.isEmpty, "D2: a state answer with nothing pending sends nothing")
}
do {
    // S4: a stored queue from an older or newer shape keeps what it has.
    let old = Data("{\"outbox\":[{\"id\":\"x\",\"kind\":\"exit\",\"gym\":\"bfit\",\"at\":0}],\"pendingExits\":{}}".utf8)
    let q = GeofenceQueue.decode(old)
    check(q.outbox.count == 1 && q.outbox[0].id == "x" && q.maybeLater.isEmpty, "S4: a missing key decodes to its default; the outbox survives")
    let partial = Data("{\"maybeLater\":[]}".utf8)
    check(GeofenceQueue.decode(partial) == GeofenceQueue(), "S4: an almost empty object decodes")
}
do {
    // S2: the same circle read back from Core Location is the same circle.
    check(GeofenceQueue.sameCircle(24.7136, 46.6753, 150, 24.71360000001, 46.67530000002, 150.0000001), "S2: float noise is the same circle")
    check(!GeofenceQueue.sameCircle(24.7136, 46.6753, 150, 24.7146, 46.6753, 150), "S2: 110 m away is a different circle")
    check(!GeofenceQueue.sameCircle(24.7136, 46.6753, 150, 24.7136, 46.6753, 600), "S2: another radius is a different circle")
}
do {
    // S1: notification calls that arrive before Capacitor's router exists.
    final class Router { var got: [String] = [] }
    let gate = ReplayGate<Router>()
    var completed = false
    gate.send { $0.got.append("rest-done"); completed = true }
    gate.send { $0.got.append("gap-tap") }
    check(!completed, "S1: a response with no router yet is HELD, never completed early")
    let r = Router()
    gate.attach(r)
    check(r.got == ["rest-done", "gap-tap"] && completed, "S1: held responses replay in order once the router is wrapped")
    gate.send { $0.got.append("later") }
    check(r.got.last == "later", "S1: after that, calls go straight through")
}

print("Geofence core — one drift rule (re-verification, 2026-10-22)")
do {
    // N1: logger open, indoor drift exit 18:30, drift re-entry 18:45.
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:30"))
    let prompt = q.enteredGym("bfit", at: at("18:45"))
    check(q.outbox.isEmpty && q.pendingExits.isEmpty && prompt == false, "N1: an UNCONFIRMED exit 15 min before re-entry is the same stay — no exit sent, no prompt")
    var q2 = GeofenceQueue()
    q2.exitedGym("bfit", at: at("17:00"))
    let p2 = q2.enteredGym("bfit", at: at("18:31"))
    check(q2.next()?.at == at("17:00") && p2 == true, "N1: an unconfirmed exit 91 min old is a departure: sent, and a new prompt")
    var q3 = GeofenceQueue()
    q3.exitedGym("bfit", at: at("18:30"))
    q3.resolvePending("bfit", side: .outside, now: at("18:33"))
    check(q3.outbox.isEmpty && q3.pendingExits["bfit"] != nil, "an outside answer before 7 min confirms but does not send yet")
    let p3 = q3.enteredGym("bfit", at: at("18:45"))
    check(q3.next()?.kind == .exit && q3.next()?.at == at("18:30") && p3 == true, "N1: a CONFIRMED exit is sent on re-entry, whatever its age, and he is asked again")
}
do {
    // N2: yesterday's departure, app opened today before the entry arrives; iOS says inside.
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:00"))
    q.resolvePending("bfit", side: .inside, now: at("18:00").addingTimeInterval(24 * 3600))
    check(q.next()?.kind == .exit && q.next()?.at == at("18:00") && q.pendingExits.isEmpty, "N2: inside, but the exit is a day old: a departure and a return — sent, not deleted")
    var q2 = GeofenceQueue()
    q2.exitedGym("bfit", at: at("18:00"))
    q2.resolvePending("bfit", side: .inside, now: at("19:29"))
    check(q2.outbox.isEmpty && q2.pendingExits.isEmpty, "N2: inside within 90 min of the exit: drift, dropped")
}
do {
    // N3: a drift exit at the desk (08:20) must not bound a 12:30 tap to 08:00.
    var q = GeofenceQueue()
    q.exitedGym("work", at: at("08:20"))
    q.checkIn(gym: "work", enteredAt: at("08:00"), tappedAt: at("12:30"), id: "w")
    check(q.outbox.first { $0.kind == .enter }?.at == at("12:30"), "N3: an unconfirmed pending exit never keeps the entry time on a late tap")
    var q2 = GeofenceQueue()
    q2.exitedGym("work", at: at("08:20"))
    q2.resolvePending("work", side: .outside, now: at("08:22"))
    q2.checkIn(gym: "work", enteredAt: at("08:00"), tappedAt: at("12:30"), id: "w")
    check(q2.outbox.first { $0.kind == .enter }?.at == at("08:00"), "N3: a CONFIRMED pending exit bounds the trip")
}
do {
    // S-a: a stale state ask must not swallow a later, unrelated answer.
    var asks = StateAsks()
    asks.ask("bfit", at: at("18:00"))
    check(asks.accept("bfit", at: at("18:00").addingTimeInterval(10)) == true, "S-a: an answer within 30 s of the ask counts")
    check(asks.accept("bfit", at: at("18:00").addingTimeInterval(12)) == false, "S-a: one answer per ask")
    asks.ask("bfit", at: at("18:00"))
    check(asks.accept("bfit", at: at("18:00").addingTimeInterval(31)) == false, "S-a: an answer 31 s after the ask is not its answer")
    asks.ask("work", at: at("18:00"))
    asks.clear("work")
    check(asks.accept("work", at: at("18:00").addingTimeInterval(5)) == false, "S-a: an enter/exit callback clears the outstanding ask")
    check(asks.accept("bfit", at: at("18:00")) == false, "S-a: no ask, no answer")
}
do {
    let old = Data("{\"outbox\":[],\"pendingExits\":{\"bfit\":0},\"maybeLater\":[]}".utf8)
    let q = GeofenceQueue.decode(old)
    check(q.pendingExits["bfit"] != nil && q.confirmedExits.isEmpty, "a queue stored before confirmations existed decodes with none")
}

print("Geofence core — persisted")
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:00"))
    q.checkIn(gym: "work", enteredAt: at("08:00"), tappedAt: at("08:01"), id: "w")
    let data = try! JSONEncoder().encode(q)
    let back = try! JSONDecoder().decode(GeofenceQueue.self, from: data)
    check(back == q, "the queue survives a relaunch byte for byte")
    check(GeofenceQueue.decode(Data("garbage".utf8)) == GeofenceQueue(), "an unreadable stored queue starts empty instead of crashing")
}

print("Geofence core — the checked-out line")
do {
    check(GeofenceQueue.checkedOutText(gym: "bfit", minutes: 83) == "Checked out of B_Fit · 1 h 23", "1 h 23, like fmtVisit")
    check(GeofenceQueue.checkedOutText(gym: "work", minutes: 45) == "Checked out of Alrajhi · 45 min", "under an hour in minutes")
    check(GeofenceQueue.checkedOutText(gym: "bfit", minutes: 60) == "Checked out of B_Fit · 1 h", "a round hour")
    let visit: [String: Any] = ["checkInAt": "2026-10-22T14:00:00.000Z", "checkOutAt": "2026-10-22T15:23:00.000Z"]
    check(GeofenceQueue.visitMinutes(visit) == 83, "the duration comes from the visit the server returned")
    check(GeofenceQueue.visitMinutes(["checkInAt": "2026-10-22T14:00:00.000Z"]) == nil, "no check-out, no duration")
}

print("\n\(passed) passed, \(failed) failed")
exit(failed > 0 ? 1 : 0)
