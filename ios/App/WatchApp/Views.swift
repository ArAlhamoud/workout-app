import SwiftUI
import WatchKit

// The four screens of docs/WATCH.md, sized for the Ultra's 49 mm always-on
// display. The watch never does data entry — confirm/adjust only.

struct RootView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        switch store.phase {
        case .idle:
            StartView()
        case .loading:
            ProgressView("Plan…")
        case .active:
            if let slot = store.currentSlot {
                // .id(slot.id) forces a FRESH SetCardView per slot. A machine
                // rotation changes the slot without changing the phase, so
                // SwiftUI would otherwise reuse the view and discard init's
                // crown seed — carrying a kg value onto the seconds card,
                // where the 5…180 range clamps it and writes a phantom short
                // hold. That is the 10 s plank bug (e9be317) by another road.
                SetCardView(slot: slot, workout: store.workout).id(slot.id)
            } else {
                SummaryView()
            }
        case .resting(let until):
            RestView(until: until)
        case .rpePrompt(_, let name):
            RPEStripView(exerciseName: name)
        case .summary:
            SummaryView()
        case .uploading:
            ProgressView("Saving…")
        case .done(let outcome):
            DoneView(outcome: outcome)
        }
    }
}

// MARK: - Start

struct StartView: View {
    @EnvironmentObject var store: SessionStore
    /// nil = the server's queued day. An override costs a deliberate tap —
    /// a crown detent was one sleeve-brush away from running the wrong day
    /// (trainer review).
    @State private var dayOverride: String?
    @State private var durIndex: Int = 0
    private let durations = [60, 45, 30]

    private var planDay: String { store.plan?.day ?? "A" }
    private var chosenDay: String { dayOverride ?? planDay }
    private var chosenDur: Int {
        if durIndex == 0 { return store.plan?.durationMin ?? 60 }
        return durations[(durIndex - 1) % durations.count]
    }
    private var otherDay: String { chosenDay == "A" ? "B" : "A" }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let p = store.plan, p.loadPct < 100 {
                    Text("RETURN · \(p.loadPct)%")
                        .font(.system(size: 12, weight: .black, design: .rounded))
                        .foregroundStyle(.orange)
                }
                // The plan's advice stays visible even though nothing blocks:
                // advice-then-allow is the program's contract.
                if let p = store.plan, p.mode != "train" {
                    Text(p.mode == "recover" ? "Recovery day — walk instead?" : "Already trained today")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                if let live = store.phoneLive {
                    // Started on the phone — pick it up here under the same
                    // save id (docs/WATCH.md "Live session").
                    Button {
                        Task { await store.continueLive(live) }
                    } label: {
                        VStack(spacing: 2) {
                            Text("Continue Day \(live.day ?? "?")")
                                .font(.system(size: 18, weight: .black, design: .rounded))
                            Text(live.sets.isEmpty ? "on the phone" : "\(live.sets.count) set\(live.sets.count == 1 ? "" : "s") on the phone")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
                Button {
                    let d = chosenDay, dur = chosenDur
                    Task { await store.start(day: d, dur: dur) }
                } label: {
                    VStack(spacing: 2) {
                        Text("Day \(chosenDay)")
                            .font(.system(size: 30, weight: .black, design: .rounded))
                        Text("\(chosenDur) min\(dayOverride == nil ? " · planned" : "")")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 76)
                }
                .buttonStyle(.borderedProminent)
                .tint(chosenDay == "A" ? .purple : .teal)

                HStack(spacing: 6) {
                    Button("Day \(otherDay)") {
                        dayOverride = dayOverride == nil ? otherDay : nil
                    }
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .buttonStyle(.bordered)
                    Button("\(durations[durIndex % durations.count]) min") {
                        durIndex += 1
                    }
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .buttonStyle(.bordered)
                }

                if let n = store.notice {
                    Text(n)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
                if store.pendingCount > 0 {
                    Text("\(store.pendingCount) session\(store.pendingCount == 1 ? "" : "s") waiting to upload")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                }
                // Refused by the server and kept here, never retried — a Mac
                // session can recover them (outbox-rejected.json).
                if store.rejectedCount > 0 {
                    Text("\(store.rejectedCount) refused — kept on watch")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                }
                // Which build is on the wrist, readable without a Mac. A swipe
                // fix "did not reach the watch" (owner, 2026-09-12) and there
                // was no way to tell from the wrist whether the new build had
                // installed at all. CFBundleVersion is the TestFlight number:
                // the export renumbers it (manageAppVersionAndBuildNumber).
                Text("build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
                    .font(.system(size: 9, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
        }
        // A phone session opened while this screen is already up must show
        // up without a wrist-down: poll the live row while idle here.
        .task {
            while !Task.isCancelled {
                await store.refreshLive()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }
}

// MARK: - Set card (the core screen)

struct SetCardView: View {
    @EnvironmentObject var store: SessionStore
    @ObservedObject var workout: WorkoutManager
    let slot: SetSlot
    /// The crown COUNTS detents; it never holds kilograms. Each change moves
    /// the weight by (new − old) steps RELATIVE to where it is, so there is
    /// no grid counted from 0 to settle onto — that grid is what "kept
    /// pulling me to the current number", and a half-step turn landing a
    /// whole 9 kg pin away was "goes way up to the farther number" (owner,
    /// 2026-09-18). Starts at 0, inside any range (the e9be317 lesson), and
    /// resets per slot because RootView gives every slot a fresh view.
    @State private var detent = 0
    @FocusState private var crownFocused: Bool

    init(slot: SetSlot, workout: WorkoutManager) {
        self.slot = slot
        self.workout = workout
    }

    private var weightText: String {
        guard slot.weightKg > 0 else { return "—" }
        // Up to two decimals, trimmed: Face Pull 8.75 read "8.8".
        return String(format: "%.2f", slot.weightKg)
            .replacingOccurrences(of: "\\.?0+$", with: "", options: .regularExpression)
    }

    /// Why the weight is what it is, only when it is not simply "last time"
    /// — the server's reason, never worked out here (rule 9).
    private var reasonLabel: (text: String, color: Color)? {
        guard !slot.isWarmup else { return nil }
        switch slot.reason {
        case "overload": return ("+1 pin", .green)
        case "deload": return ("deload", .orange)
        case "short": return ("−1 pin", .orange)
        // A coarse step: the prescription asks for one more rep before the pin.
        case "reps": return ("+1 rep", .green)
        default: return nil
        }
    }

    var body: some View {
        VStack(spacing: 6) {
            // The counter — "2/6" — with no machine name (owner, 2026-09-12:
            // "remove the machine name just keep 1/6"). A reason rides beside
            // it only when the prescription moved; a heart only when the
            // workout session is NOT running (tap to restart it).
            if store.machinePosition != nil || reasonLabel != nil || !workout.isActive {
                HStack(spacing: 4) {
                    if let pos = store.machinePosition {
                        Text("\(pos.index)/\(pos.total)")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    if let r = reasonLabel {
                        Text("· \(r.text)").foregroundStyle(r.color)
                    }
                    if !workout.isActive {
                        Button {
                            Task { await workout.recoverOrBegin() }
                        } label: {
                            Image(systemName: "heart.slash.fill").foregroundStyle(.orange)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Workout not recording — tap to restart")
                    }
                }
                .font(.system(size: 12, weight: .semibold, design: .rounded))
            }
            Text(slot.isWarmup ? "Warm-up · \(slot.exerciseName)" : "Set \(slot.setNumber)/\(slot.setsTotal) · \(slot.exerciseName)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(slot.isWarmup ? Color.orange : Color.primary)
                .lineLimit(1)

            if slot.isSeconds {
                // Plank-class card: the hold time IS the progression axis —
                // the crown owns seconds, one detent = one second, and
                // kilograms don't exist here (a brush must not write phantom kg).
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(slot.reps)")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .monospacedDigit()
                    Text("sec hold")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                .focusable()
                .focused($crownFocused)
                .digitalCrownRotation(
                    detent: $detent, from: -1000, through: 1000, by: 1,
                    sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true
                )
                .onChange(of: detent) { old, new in store.nudge(detents: new - old) }
                .onAppear { crownFocused = true }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(weightText)
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .monospacedDigit()
                    Text("kg")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                    // Tap = one more rep (wrapping at the top of the range);
                    // hold = one fewer, down to 1, so a short set is
                    // recordable (trainer ruling 6). One gesture, exclusive:
                    // a hold never also counts as a tap. Orange below the range.
                    Text("× \(slot.reps)")
                        .font(.system(size: 26, weight: .black, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(slot.reps < slot.repsMin ? Color.orange : Color.teal)
                        .contentShape(Rectangle())
                        .gesture(
                            LongPressGesture(minimumDuration: 0.5)
                                .onEnded { _ in store.decrementReps() }
                                .exclusively(before: TapGesture().onEnded { store.cycleReps() })
                        )
                        .accessibilityLabel("\(slot.reps) reps")
                        .accessibilityHint("Tap for one more, hold for one fewer")
                }
                .focusable()
                .focused($crownFocused)
                .digitalCrownRotation(
                    detent: $detent, from: -1000, through: 1000, by: 1,
                    sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true
                )
                .onChange(of: detent) { old, new in store.nudge(detents: new - old) }
                .onAppear { crownFocused = true }
            }

            if !slot.isSeconds && slot.weightKg <= 0 {
                Text("turn the crown to set weight")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            if store.pendingMachineCount > 1, let next = store.nextMachineName {
                // Occupied machine (owner, 2026-09-07): swipe is the gesture,
                // but the hint that names the target is itself tappable — a
                // swipe missed on the gym floor once left him stuck with no
                // fallback (field report, 2026-09-02). Plain style: a line of
                // text, not a button, so the card keeps its glance.
                // Tap = forward, the "it's taken" case; swipe right comes back.
                // ONE chevron, trailing, matching the rest screen. A leading
                // ‹ was here and it lied: the whole row goes forward, so the
                // glyph that means "back" advanced him — and tapping again to
                // undo advanced him further (adversary + device-tester both,
                // 2026-09-07). Back is swipe-right, which the card no longer
                // promises as a tap. contentShape because .plain alone
                // hit-tests the glyphs, not the padded frame.
                Button { store.skipToNextMachine() } label: {
                    Text("\(next) ›")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                // Measured 5.75 pt to the green Log set button, whose mis-tap
                // writes a set and starts a rest. Buy back clearance.
                .padding(.bottom, 4)
            }
            Button {
                store.logCurrentSet()
            } label: {
                Text(!slot.isSeconds && slot.weightKg <= 0 ? "Log bodyweight · 0 kg" : slot.isWarmup ? "Log warm-up" : "Log set")
                    .font(.system(size: !slot.isSeconds && slot.weightKg <= 0 ? 14 : 17, weight: .black, design: .rounded))
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.borderedProminent)
            .tint(!slot.isSeconds && slot.weightKg <= 0 ? .orange : .green)
            if slot.isWarmup {
                // Warm or not is his call — the card never traps him on it.
                Button("skip warm-up") { store.skipWarmup() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .contentShape(Rectangle())
            }
        }
        .padding(.horizontal, 2)
        .contentShape(Rectangle())
        // Occupied machine: a horizontal swipe rotates the pending machines.
        // 40 pt minimum so a crown nudge or a sleeve brush never triggers it
        // (the same accidental-input worry that removed the day detent).
        // High priority so a drag that starts on the weight or a button is
        // not swallowed by the child (the hidden-gesture failure, build 8).
        //
        // Do NOT lower the minimum or judge by predictedEndTranslation to
        // "catch fast flicks" — tried 2026-09-12, reverted the same night.
        // Because this gesture outranks the buttons, a 20 pt minimum let a
        // sideways press on Log set switch machines instead of logging, and a
        // reflexive second tap then logged the set under the WRONG machine at
        // the wrong weight, unrecoverable from the wrist. The predicted
        // vector also turned curled flicks, hooked vertical wipes and
        // rebounds into wrong rotations (adversary, reproduced in SwiftUI's
        // gesture engine). The sim's "0.3 s flick does nothing" that
        // motivated it was most likely how the tool injects touches: a
        // straight swipe that ends ≥ 40 pt from where it started fires here.
        .highPriorityGesture(
            DragGesture(minimumDistance: 40)
                .onEnded { v in
                    guard abs(v.translation.width) > abs(v.translation.height) else { return }
                    if v.translation.width < 0 { store.skipToNextMachine() } else { store.backToPreviousMachine() }
                }
        )
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("End") { store.endEarly() }
                    .font(.system(size: 12, design: .rounded))
            }
        }
    }
}

// MARK: - Rest

struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let until: Date

    private func kg(_ w: Double) -> String {
        String(format: "%.2f", w).replacingOccurrences(of: "\\.?0+$", with: "", options: .regularExpression)
    }

    var body: some View {
        ScrollView {
        VStack(spacing: 8) {
            Text("REST")
                .font(.system(size: 13, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
            // Never `Date()...until` straight: once `until` has passed and the
            // view re-renders before the timer fires, that range traps.
            Text(timerInterval: SessionCore.restRange(now: Date(), until: until), countsDown: true)
                .font(.system(size: 44, weight: .black, design: .rounded))
                .monospacedDigit()
                .multilineTextAlignment(.center)
            if let next = store.currentSlot {
                // The machine he is walking to AND its weight, so the pin can
                // be set before he sits down (C1). The server's number.
                let what = next.isWarmup ? "warm-up" : "set \(next.setNumber)"
                let weight = !next.isSeconds && next.weightKg > 0 ? " · \(kg(next.weightKg)) kg" : ""
                Text("Next: \(next.exerciseName) · \(what)\(weight)")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            Button("Skip") { store.skipRest() }
                .buttonStyle(.bordered)
                .font(.system(size: 14, weight: .bold, design: .rounded))
            // He walks to the next machine DURING the rest — this is where
            // "it's taken" is discovered, so the switch lives here too. The
            // machine AT RISK is the one he is walking to (the slot that is
            // up next), not the one a switch would land him on.
            if store.pendingMachineCount > 1, store.nextMachineName != nil,
               let walkingTo = store.currentSlot?.exerciseName {
                Button { store.switchMachineFromRest() } label: {
                    Text("\(walkingTo) taken? ›")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            // '+1 set' — only after a below-cap rating on a machine that
            // allows it, once per machine (trainer ruling 2). Recording, not
            // a suggestion: the extra set is simply next.
            if let name = store.extraSetOfferName {
                Button { store.addExtraSet() } label: {
                    Text("+1 set · \(name)")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.bordered)
            }
            if store.undoableSet != nil {
                Button { store.undoLastSet() } label: {
                    Text("undo last set")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        // Tap anywhere to end the rest — kept from the first build.
        .onTapGesture { store.skipRest() }
        }
        .highPriorityGesture(
            // 40 pt, translation only — see the set card for why the 20 pt
            // predicted-flick version was reverted.
            DragGesture(minimumDistance: 40)
                .onEnded { v in
                    guard abs(v.translation.width) > abs(v.translation.height), v.translation.width < 0 else { return }
                    // Gated: an ungated brush on the last machine ate the rest.
                    guard store.pendingMachineCount > 1 else { return }
                    store.switchMachineFromRest()
                }
        )
    }
}

// MARK: - RPE strip

struct RPEStripView: View {
    @EnvironmentObject var store: SessionStore
    let exerciseName: String

    private let labels = ["Easy", "Med", "Hard", "Grind"]
    private let tints: [Color] = [.green, .teal, .orange, .red]

    var body: some View {
        ScrollView {
        VStack(spacing: 5) {
            Text(exerciseName)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .lineLimit(1)
            Text("How hard?")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
            // Every button always tappable: the cap is a prescription for
            // how hard the set SHOULD be, never a limit on reporting how
            // hard it WAS — a censored Grind during a ramp week is exactly
            // the signal that slows the ramp (trainer review, blocking).
            let cap = store.session?.rpeCap ?? 4
            if cap < 4 {
                // "Ramp target" only while the ramp scales loads; at 100% the
                // cap is the chart's effort ceiling, not a ramp.
                Text("\((store.session?.loadPct ?? 100) < 100 ? "Ramp target" : "Ceiling"): ≤ \(labels[cap - 1])")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.orange)
            }
            ForEach(0..<4, id: \.self) { i in
                Button {
                    if case .rpePrompt(let exId, _) = store.phase {
                        store.setRPE(i + 1, exerciseId: exId)
                    }
                } label: {
                    Text(labels[i])
                        .font(.system(size: 14, weight: .black, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 26)
                }
                .buttonStyle(.borderedProminent)
                .tint(tints[i].opacity(i + 1 > cap ? 0.55 : 1))
            }
            // An unrated exercise is honest data too — never force a tap.
            Button("skip") { store.skipRPE() }
                .buttonStyle(.plain)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
            // A mis-logged last set: take it back before rating it.
            Button("undo last set") { store.undoLastSet() }
                .buttonStyle(.plain)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 2)
        }
    }
}

// MARK: - Summary / Done

struct SummaryView: View {
    @EnvironmentObject var store: SessionStore
    @State private var confirmDiscard = false

    /// Working sets only — warm-ups count for nothing.
    private var working: [LogSet] { store.session?.logged.filter { !$0.isWarmup } ?? [] }

    private var topWeights: [(String, Double)] {
        guard let s = store.session else { return [] }
        var best: [String: (name: String, kg: Double)] = [:]
        for set in working {
            let name = s.slots.first { $0.exerciseId == set.exerciseId }?.exerciseName ?? "?"
            if set.weight > (best[set.exerciseId]?.kg ?? -1) {
                best[set.exerciseId] = (name, set.weight)
            }
        }
        return best.values.sorted { $0.kg > $1.kg }.prefix(3).map { ($0.name, $0.kg) }
    }

    private func kg(_ w: Double) -> String {
        String(format: "%.2f", w).replacingOccurrences(of: "\\.?0+$", with: "", options: .regularExpression)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                let mins = Int(Date().timeIntervalSince(store.session?.startedAt ?? Date()) / 60)
                Text("\(working.count) sets · \(mins) min")
                    .font(.system(size: 17, weight: .black, design: .rounded))
                ForEach(topWeights, id: \.0) { name, w in
                    HStack {
                        Text(name).font(.system(size: 12, weight: .semibold, design: .rounded)).lineLimit(1)
                        Spacer()
                        Text("\(kg(w)) kg")
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .monospacedDigit()
                    }
                }
                if let n = store.notice {
                    Text(n)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
                Button {
                    Task { await store.finish() }
                } label: {
                    Text("Finish & save")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: 38)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                // "End" can be taken back: pending sets are still there.
                if let next = store.currentSlot {
                    Button { store.backToSet() } label: {
                        Text("Back to \(next.exerciseName)")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.bordered)
                }
                if let name = store.extraSetOfferName {
                    Button { store.addExtraSet() } label: {
                        Text("+1 set · \(name)")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.bordered)
                }
                if store.undoableSet != nil {
                    Button("undo last set") { store.undoLastSet() }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                // Always offered: a test run with logged sets needs a way
                // out that isn't "save it into the training history". Asks
                // first — one tap used to throw the session away.
                Button(working.isEmpty ? "Discard" : "Discard — don't save") {
                    if store.session?.logged.isEmpty ?? true { store.discard() } else { confirmDiscard = true }
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .font(.system(size: 13, design: .rounded))
            }
            .padding(.horizontal, 4)
        }
        .confirmationDialog("Discard this session?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { store.discard() }
            Button("Keep", role: .cancel) {}
        } message: {
            Text(store.session?.gym != nil ? "Sets logged on the phone stay there." : "Nothing from this session is saved.")
        }
    }
}

struct DoneView: View {
    @EnvironmentObject var store: SessionStore
    let outcome: SessionStore.DoneOutcome

    private var icon: (name: String, color: Color) {
        switch outcome {
        case .saved, .merged: return ("checkmark.circle.fill", .green)
        case .banked: return ("tray.and.arrow.up", .orange)
        case .rejected: return ("exclamationmark.triangle.fill", .orange)
        }
    }

    private var line: String {
        switch outcome {
        case .saved: return "Session saved"
        case .merged: return "Added to the phone's workout"
        case .banked: return "Saved on watch — will upload"
        case .rejected: return "Server refused it — kept on watch"
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon.name)
                .font(.system(size: 34))
                .foregroundStyle(icon.color)
            Text(line)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .multilineTextAlignment(.center)
            Button("Done") { store.reset() }
                .buttonStyle(.borderedProminent)
        }
    }
}
