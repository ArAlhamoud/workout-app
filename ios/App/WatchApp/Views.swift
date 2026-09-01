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
                SetCardView(slot: slot)
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
        case .done(let banked):
            DoneView(banked: banked)
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
            }
            .padding(.horizontal, 4)
        }
    }
}

// MARK: - Set card (the core screen)

struct SetCardView: View {
    @EnvironmentObject var store: SessionStore
    let slot: SetSlot
    @State private var crownWeight: Double = 0
    @FocusState private var crownFocused: Bool

    private var weightText: String {
        slot.weightKg <= 0 ? "—" : slot.weightKg.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(slot.weightKg))
            : String(format: "%.1f", slot.weightKg)
    }

    var body: some View {
        VStack(spacing: 6) {
            Text(slot.machine)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text("Set \(slot.setNumber)/\(slot.setsTotal) · \(slot.exerciseName)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .lineLimit(1)

            if slot.isSeconds {
                // Plank-class card: the hold time IS the progression axis —
                // the crown owns seconds and kilograms don't exist here
                // (trainer review: a crown brush must not write phantom kg).
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
                    $crownWeight,
                    from: 5, through: 180, by: 5,
                    sensitivity: .medium, isContinuous: false
                )
                .onChange(of: crownWeight) { _, v in
                    store.setSeconds(Int(v))
                }
                .onAppear { crownWeight = Double(slot.reps); crownFocused = true }
                .onChange(of: slot.id) { _, _ in crownWeight = Double(slot.reps); crownFocused = true }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(weightText)
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .monospacedDigit()
                    Text("kg")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                    Button {
                        store.cycleReps()
                    } label: {
                        Text("× \(slot.reps)")
                            .font(.system(size: 26, weight: .black, design: .rounded))
                            .monospacedDigit()
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.teal)
                }
                .focusable()
                .focused($crownFocused)
                .digitalCrownRotation(
                    $crownWeight,
                    from: 0, through: 500, by: max(slot.pinKg, 0.5),
                    sensitivity: .medium, isContinuous: false
                )
                .onChange(of: crownWeight) { _, v in
                    store.adjust(weight: v)
                }
                .onAppear { crownWeight = slot.weightKg; crownFocused = true }
                .onChange(of: slot.id) { _, _ in crownWeight = slot.weightKg; crownFocused = true }
            }

            if !slot.isSeconds && slot.weightKg <= 0 {
                Text("turn the crown to set weight")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            if store.pendingMachineCount > 1 {
                // Occupied machine: swipe to the next one, come back later.
                Text("‹ swipe · other machine ›")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            Button {
                store.logCurrentSet()
            } label: {
                Text(!slot.isSeconds && slot.weightKg <= 0 ? "Log bodyweight · 0 kg" : "Log set")
                    .font(.system(size: !slot.isSeconds && slot.weightKg <= 0 ? 14 : 17, weight: .black, design: .rounded))
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.borderedProminent)
            .tint(!slot.isSeconds && slot.weightKg <= 0 ? .orange : .green)
        }
        .padding(.horizontal, 2)
        .contentShape(Rectangle())
        // Occupied machine: a horizontal swipe rotates the pending machines.
        // 40 pt minimum so a crown nudge or a sleeve brush never triggers it
        // (the same accidental-input worry that removed the day detent).
        .gesture(
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

    var body: some View {
        VStack(spacing: 8) {
            Text("REST")
                .font(.system(size: 13, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
            Text(timerInterval: Date()...until, countsDown: true)
                .font(.system(size: 44, weight: .black, design: .rounded))
                .monospacedDigit()
                .multilineTextAlignment(.center)
            if let next = store.currentSlot {
                Text("Next: \(next.exerciseName) · set \(next.setNumber)")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            Button("Skip") { store.skipRest() }
                .buttonStyle(.bordered)
                .font(.system(size: 14, weight: .bold, design: .rounded))
        }
        .contentShape(Rectangle())
        .onTapGesture { store.skipRest() }
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
                Text("Ramp target: ≤ \(labels[cap - 1])")
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
        }
        .padding(.horizontal, 2)
        }
    }
}

// MARK: - Summary / Done

struct SummaryView: View {
    @EnvironmentObject var store: SessionStore

    private var topWeights: [(String, Double)] {
        guard let s = store.session else { return [] }
        var best: [String: (name: String, kg: Double)] = [:]
        for set in s.logged {
            let name = s.slots.first { $0.exerciseId == set.exerciseId }?.exerciseName ?? "?"
            if set.weight > (best[set.exerciseId]?.kg ?? -1) {
                best[set.exerciseId] = (name, set.weight)
            }
        }
        return best.values.sorted { $0.kg > $1.kg }.prefix(3).map { ($0.name, $0.kg) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                let logged = store.session?.logged.count ?? 0
                let mins = Int(Date().timeIntervalSince(store.session?.startedAt ?? Date()) / 60)
                Text("\(logged) sets · \(mins) min")
                    .font(.system(size: 17, weight: .black, design: .rounded))
                ForEach(topWeights, id: \.0) { name, kg in
                    HStack {
                        Text(name).font(.system(size: 12, weight: .semibold, design: .rounded)).lineLimit(1)
                        Spacer()
                        Text("\(kg.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(kg)) : String(format: "%.1f", kg)) kg")
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .monospacedDigit()
                    }
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
                // Always offered: a test run with logged sets needs a way
                // out that isn't "save it into the training history".
                Button(store.session?.logged.isEmpty ?? true ? "Discard" : "Discard — don't save") {
                    store.discard()
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .font(.system(size: 13, design: .rounded))
            }
            .padding(.horizontal, 4)
        }
    }
}

struct DoneView: View {
    @EnvironmentObject var store: SessionStore
    let banked: Bool

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: banked ? "tray.and.arrow.up" : "checkmark.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(banked ? .orange : .green)
            Text(banked ? "Saved on watch — will upload" : "Session saved")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .multilineTextAlignment(.center)
            Button("Done") { store.reset() }
                .buttonStyle(.borderedProminent)
        }
    }
}
