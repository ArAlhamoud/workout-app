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
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), id: "e1")
    check(q.next()?.kind == .enter && q.next()?.at == at("17:00"), "Check in queues an enter at the ENTRY time, not the tap time")
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), id: "e2")
    check(q.outbox.count == 1, "a second tap on the same prompt queues nothing new")
}

print("Geofence core — leaving waits out drift")
do {
    var q = GeofenceQueue()
    _ = q.enteredGym("bfit", at: at("17:00"))
    q.exitedGym("bfit", at: at("18:30"))
    check(q.outbox.isEmpty && q.pendingExits["bfit"] == at("18:30"), "leaving the small circle parks a pending exit, sends nothing")
    q.wake(now: at("18:30").addingTimeInterval(6 * min))
    check(q.outbox.isEmpty, "a wake 6 min after leaving still sends nothing")
    q.wake(now: at("18:30").addingTimeInterval(7 * min))
    check(q.next()?.kind == .exit && q.next()?.at == at("18:30") && q.pendingExits.isEmpty, "a wake 7 min after leaving sends the exit at the ORIGINAL exit time")
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
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), id: "late")
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
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), id: "late")
    let enter = q.next()!
    check(enter.kind == .enter, "the late enter is sent")
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
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), id: "e")
    q.answered(q.next()!, action: "created", now: at("18:20"))
    check(q.outbox.isEmpty && q.maybeLater.count == 2, "an enter re-sends only that gym's exits AFTER its entry time")
    q.checkIn(gym: "bfit", enteredAt: at("17:30"), id: "e2")
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
    q.checkIn(gym: "bfit", enteredAt: at("17:00"), id: "bad")
    q.rejected(q.next()!)
    check(q.outbox.isEmpty, "an event the server refuses as malformed is dropped, so it cannot block the queue for good")
}

print("Geofence core — persisted")
do {
    var q = GeofenceQueue()
    q.exitedGym("bfit", at: at("18:00"))
    q.checkIn(gym: "work", enteredAt: at("08:00"), id: "w")
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
