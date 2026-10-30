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
    /// nil = the plan's own length (no `dur` sent). A tap on a chip picks
    /// one; a tap on the planned length goes back to nil (SessionCore.pickLength).
    @State private var pickedDur: Int?

    private var planDay: String { store.plan?.day ?? "A" }
    private var chosenDay: String { dayOverride ?? planDay }
    private var chosenDur: Int { SessionCore.shownLength(picked: pickedDur, planned: store.plan?.durationMin) }
    private var otherDay: String { chosenDay == "A" ? "B" : "A" }

    /// #30D158 + black: 10.4:1. The tinted button carried white at ~2:1.
    private static let continueGreen = Color(red: 0x30 / 255, green: 0xD1 / 255, blue: 0x58 / 255)

    /// "build 13 · Sep 24" — the date is the executable's own file date,
    /// read once: it changes with every compile, whatever the number says.
    private static let buildLabel: String = {
        let built = Bundle.main.executableURL
            .flatMap { try? FileManager.default.attributesOfItem(atPath: $0.path)[.modificationDate] as? Date }
        return SessionCore.buildLabel(version: Bundle.main.infoDictionary?["CFBundleVersion"] as? String, builtAt: built)
    }()

    /// The phone's /train names each day's focus on its directive card
    /// (DAY_FOCUS); the wrist repeats the same label, nothing more.
    private static func focus(_ day: String) -> String {
        day == "A" ? "Chest · Quads · Shoulders" : "Back · Hamstrings · Arms"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                // Volt topline: what the plan says about today, mono kicker.
                if let p = store.plan, p.loadPct < 100 {
                    VoltFlag(text: "Return · \(p.loadPct)% load", ground: .orange, ink: .black)
                }
                // The plan's advice stays visible even though nothing blocks:
                // advice-then-allow is the program's contract.
                if let p = store.plan, p.mode != "train" {
                    Text(p.mode == "recover" ? "Recovery day — walk instead?" : "Already trained today")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(0.6)
                        .foregroundStyle(.white.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let live = store.phoneLive {
                    // Started on the phone — pick it up here under the same
                    // save id (docs/WATCH.md "Live session").
                    Button {
                        Task { await store.continueLive(live) }
                    } label: {
                        VStack(spacing: 2) {
                            Text("Continue Day \(live.day ?? "?")")
                                .font(.system(.headline, design: .rounded, weight: .black))
                                .textCase(.uppercase)
                            Text(live.sets.isEmpty ? "on the phone" : "\(live.sets.count) set\(live.sets.count == 1 ? "" : "s") on the phone")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .textCase(.uppercase)
                        }
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Self.continueGreen)
                    }
                    .buttonStyle(.plain)
                }

                GymRow()

                // The directive card — /train's queued-day slab: solid volt,
                // black ink, square corners, offset solid shadow — the same slab
                // for either day, as on the phone.
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .center) {
                        VoltFlag(text: dayOverride != nil ? "Your pick" : store.offeredDay != nil ? "Saved plan" : "Up next",
                                 ground: .black, ink: Volt.lime)
                        Spacer(minLength: 0)
                    }
                    Text("Day \(chosenDay)")
                        .font(.system(size: 30, weight: .black, design: .rounded))
                        .textCase(.uppercase)
                        .foregroundStyle(.black)
                        .padding(.top, 5)
                    Text(Self.focus(chosenDay))
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(.black.opacity(0.72))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    // WHICH length: all three at once, the chosen one black.
                    HStack(spacing: 5) {
                        ForEach(SessionCore.lengthOptions, id: \.self) { m in
                            let on = m == chosenDur
                            Button {
                                pickedDur = SessionCore.pickLength(m, planned: store.plan?.durationMin)
                            } label: {
                                VStack(spacing: 1) {
                                    Text("\(m)")
                                        .font(.system(size: 18, weight: .black, design: .rounded))
                                        .monospacedDigit()
                                    Text("MIN")
                                        .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                                        .opacity(0.75)
                                }
                                .foregroundStyle(on ? Volt.lime : Color.black)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(on ? Color.black : Color.black.opacity(0.1))
                                .overlay(Rectangle().strokeBorder(Color.black, lineWidth: 1.5))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(m) minutes")
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.top, 10)

                    Button {
                        // "planned" means the SERVER's queue: no day and no
                        // length are sent unless he picked them. The screen's
                        // own day went out as an explicit ask — stale by a
                        // session, the server still obeyed it.
                        // A day the wrist offered by name (it could not confirm
                        // the queue) is sent by name on this confirming tap.
                        let d = SessionCore.startDay(override: dayOverride, offered: store.offeredDay)
                        let dur: Int? = pickedDur
                        // With no day sent, what opens must be the day this
                        // button reads; a queue that moved is shown, not opened.
                        let promised = d == nil ? store.plan?.day : nil
                        Task { await store.start(day: d, dur: dur, promised: promised) }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill").font(.system(size: 11, weight: .black))
                            Text(SessionCore.startTitle(day: chosenDay, minutes: chosenDur))
                                .font(.system(size: 15, weight: .black, design: .rounded))
                                .textCase(.uppercase)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        .padding(.horizontal, 12)
                        .foregroundStyle(Volt.lime)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Parallelogram().fill(Color.black))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 9)
                }
                .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 10))
                .background(Volt.lime)
                .overlay(Rectangle().strokeBorder(Volt.bone, lineWidth: 1.5))
                .background(Rectangle().fill(Volt.bone.opacity(0.9)).offset(x: 3, y: 3))
                .padding(.trailing, 3)

                // The other day costs a deliberate tap, below the start.
                Button {
                    dayOverride = dayOverride == nil ? otherDay : nil
                } label: {
                    Text(dayOverride == nil ? "Switch to Day \(otherDay)" : "Back to Day \(otherDay)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .overlay(Rectangle().strokeBorder(Color.white.opacity(0.55), lineWidth: 1.5))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 4)

                CardioRow()
                    .padding(.top, 8)

                if let n = store.notice {
                    Text(n)
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
                if store.pendingCount > 0 {
                    Text("\(store.pendingCount) session\(store.pendingCount == 1 ? "" : "s") waiting to upload")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(.orange)
                }
                // Refused by the server and kept here, never retried — a Mac
                // session can recover them (outbox-rejected.json).
                if store.rejectedCount > 0 {
                    Text("\(store.rejectedCount) refused — kept on watch")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(.orange)
                }
                // Which build is on the wrist, readable without a Mac. A swipe
                // fix "did not reach the watch" (owner, 2026-09-12) and there
                // was no way to tell from the wrist whether the new build had
                // installed at all. CFBundleVersion is the TestFlight number:
                // the export renumbers it (manageAppVersionAndBuildNumber).
                // The number alone read 13 from 2026-09-12 on, through many
                // dev installs of different code — so the day the binary
                // was built rides beside it.
                Text(Self.buildLabel)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
        }
        // A phone session opened while this screen is already up must show
        // up without a wrist-down: poll the live row while idle here.
        .task {
            while !Task.isCancelled {
                await store.refreshLive()
                await store.refreshGym()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }
}

// MARK: - Swim / walk

/// The Train page's quick log on the wrist (owner, 2026-10-31): minutes,
/// then Swim or Walk. Asks first — a sleeve brush must not file a workout.
struct CardioRow: View {
    @EnvironmentObject var store: SessionStore
    @State private var minutes = SessionCore.cardioStart
    @State private var asking: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            VoltFlag(text: "Swim or walk", ground: .black, ink: Volt.lime)
            HStack(spacing: 4) {
                Button { minutes = SessionCore.stepCardio(minutes, by: -1) } label: {
                    Text("−").voltMono(16, .heavy).frame(width: 40, height: 36)
                }
                .buttonStyle(VoltOutline())
                .accessibilityLabel("5 minutes less")
                Spacer(minLength: 0)
                Text("\(minutes)")
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .monospacedDigit()
                Text("MIN").voltMono(9).foregroundStyle(.white.opacity(0.7))
                Spacer(minLength: 0)
                Button { minutes = SessionCore.stepCardio(minutes, by: 1) } label: {
                    Text("+").voltMono(16, .heavy).frame(width: 40, height: 36)
                }
                .buttonStyle(VoltOutline())
                .accessibilityLabel("5 minutes more")
            }
            HStack(spacing: 5) {
                ForEach(["swim", "walk"], id: \.self) { k in
                    Button { asking = k } label: {
                        Text(k == "swim" ? "Swim" : "Walk")
                            .voltMono(12, .heavy)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(VoltOutline(ink: Volt.lime))
                    .disabled(store.cardioBusy)
                }
            }
            if let n = store.cardioNotice {
                Text(n)
                    .voltMono(10)
                    .foregroundStyle(n.hasPrefix("No signal") ? .orange : Volt.lime)
            }
        }
        .confirmationDialog(asking.map { "Log a \(minutes) min \($0)?" } ?? "",
                            isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
                            titleVisibility: .visible) {
            Button("Log it") {
                if let k = asking { Task { await store.logCardio(kind: k, minutes: minutes) } }
                asking = nil
            }
            Button("Cancel", role: .cancel) { asking = nil }
        }
    }
}

// MARK: - Gym check-in

/// One row above the day card (owner, 2026-10-29): Check in at B_Fit or
/// Alrajhi when nothing is open, or where and since when, with Out. Hidden
/// until the server has answered — never a check-in offered blind.
struct GymRow: View {
    @EnvironmentObject var store: SessionStore
    @State private var confirmOut = false

    var body: some View {
        if store.gymKnown {
            VStack(alignment: .leading, spacing: 4) {
                if let v = store.gymVisit {
                    HStack(spacing: 6) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("In · \(SessionCore.gymName(v.gym))")
                                .voltMono(11, .heavy)
                                .foregroundStyle(Volt.lime)
                            TimelineView(.periodic(from: .now, by: 60)) { ctx in
                                Text(v.checkInDate.map { SessionCore.visitLine(checkInAt: $0, now: ctx.date) } ?? "")
                                    .voltMono(10)
                                    .foregroundStyle(.white.opacity(0.75))
                                    .monospacedDigit()
                            }
                        }
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                        // Asks first: a stray touch after the session, still
                        // in the building, would store a short visit the
                        // phone's real exit can no longer correct.
                        Button { confirmOut = true } label: {
                            Text("Out")
                                .voltMono(12, .heavy)
                                .frame(minWidth: 56, minHeight: 36)
                        }
                        .buttonStyle(VoltOutline())
                        .disabled(store.gymBusy)
                        .accessibilityLabel("Check out of \(SessionCore.gymName(v.gym))")
                    }
                    .confirmationDialog("Check out of \(SessionCore.gymName(v.gym))?", isPresented: $confirmOut, titleVisibility: .visible) {
                        Button("Check out") { Task { await store.checkOut() } }
                        Button("Stay", role: .cancel) {}
                    }
                } else {
                    VoltFlag(text: store.gymBusy ? "Checking in…" : "Check in", ground: .black, ink: Volt.lime)
                    // Which building: the wrist cannot tell, so he says.
                    HStack(spacing: 5) {
                        ForEach(["bfit", "work"], id: \.self) { g in
                            Button { Task { await store.checkIn(gym: g) } } label: {
                                Text(SessionCore.gymName(g))
                                    .voltMono(12, .heavy)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                                    .frame(maxWidth: .infinity, minHeight: 40)
                            }
                            .buttonStyle(VoltOutline(ink: Volt.lime))
                            .disabled(store.gymBusy)
                            .accessibilityLabel("Check in at \(SessionCore.gymName(g))")
                        }
                    }
                }
                if let n = store.gymNotice {
                    Text(n)
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(.orange)
                }
            }
        }
    }
}

// MARK: - Volt (the phone's training skin, on the wrist)

/// The phone's training routes wear Volt (CLAUDE.md "Two skins"): OLED
/// black, #CDFF00, mono kickers, square corners. The Start screen speaks
/// the same language as /train's "Up next" card.
enum Volt {
    static let lime = Color(red: 0xCD / 255, green: 0xFF / 255, blue: 0x00 / 255)
    static let bone = Color(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF0 / 255)
}

/// /train's skewed kicker flag: mono caps on a slanted slab.
struct VoltFlag: View {
    let text: String
    let ground: Color
    let ink: Color
    var body: some View {
        Text(text)
            .font(.system(size: 9.5, weight: .heavy, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.4)
            .foregroundStyle(ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Parallelogram(slant: 0.12).fill(ground))
    }
}

/// A square slab button: black ink on a bright fill (volt, or a meaning
/// colour such as an RPE). Presses dim; nothing rounds.
struct VoltSlab: ButtonStyle {
    var fill: Color = Volt.lime
    var ink: Color = .black
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(ink)
            .background(Rectangle().fill(fill))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Rectangle())
    }
}

/// A square outlined button on the black ground: the secondary action.
struct VoltOutline: ButtonStyle {
    var ink: Color = .white
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(ink)
            .overlay(Rectangle().strokeBorder(ink.opacity(0.6), lineWidth: 1.5))
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(Rectangle())
    }
}

/// Mono caps for kickers and quiet lines, as /train's volt-topline.
extension View {
    func voltMono(_ size: CGFloat, _ weight: Font.Weight = .bold) -> some View {
        self.font(.system(size: size, weight: weight, design: .monospaced)).textCase(.uppercase)
    }
}

/// The volt start bar's clip-path, polygon(2% 0, 100% 0, 98% 100%, 0 100%).
struct Parallelogram: Shape {
    var slant: CGFloat = 0.03
    func path(in r: CGRect) -> Path {
        let d = r.width * slant
        var p = Path()
        p.move(to: CGPoint(x: r.minX + d, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - d, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
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
            // No heart once this session's workout is saved: a restart then
            // would put a second workout on top of it in Health (rule 11).
            let heartDown = !workout.isActive && store.session?.hkEnded != true
            if store.machinePosition != nil || reasonLabel != nil || heartDown {
                HStack(spacing: 4) {
                    if let pos = store.machinePosition {
                        Text("\(pos.index)/\(pos.total)")
                            .foregroundStyle(.white.opacity(0.7))
                            .monospacedDigit()
                    }
                    if let r = reasonLabel {
                        Text("· \(r.text)").foregroundStyle(r.color == .green ? Volt.lime : r.color)
                    }
                    if heartDown {
                        Button {
                            let begun = SessionCore.healthRestartStart(startedAt: store.session?.startedAt ?? Date(), now: Date())
                            Task { await workout.recoverOrBegin(startDate: begun) }
                        } label: {
                            Image(systemName: "heart.slash.fill").foregroundStyle(.orange)
                                .frame(minWidth: 32, minHeight: 28)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Workout not recording — tap to restart")
                    }
                }
                .voltMono(11)
            }
            Text(slot.isWarmup ? "Warm-up · \(slot.exerciseName)" : "Set \(slot.setNumber)/\(slot.setsTotal) · \(slot.exerciseName)")
                .voltMono(11, .heavy)
                .foregroundStyle(slot.isWarmup ? Color.orange : Volt.lime)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            if slot.isSeconds {
                // Plank-class card: the hold time IS the progression axis —
                // the crown owns seconds, one detent = one second, and
                // kilograms don't exist here (a brush must not write phantom kg).
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(slot.reps)")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .monospacedDigit()
                    Text("sec hold")
                        .voltMono(12)
                        .foregroundStyle(.white.opacity(0.7))
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
                        .voltMono(12)
                        .foregroundStyle(.white.opacity(0.7))
                    // Tap = one more rep (wrapping at the top of the range);
                    // hold = one fewer, down to 1, so a short set is
                    // recordable (trainer ruling 6). One gesture, exclusive:
                    // a hold never also counts as a tap. Orange below the range.
                    Text("× \(slot.reps)")
                        .font(.system(size: 26, weight: .black, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(slot.reps < slot.repsMin ? Color.orange : Volt.lime)
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
                    .voltMono(10)
                    .foregroundStyle(.white.opacity(0.7))
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
                        .voltMono(11)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.7))
                // Measured 5.75 pt to the green Log set button, whose mis-tap
                // writes a set and starts a rest. Buy back clearance.
                .padding(.bottom, 4)
            }
            Button {
                store.logCurrentSet()
            } label: {
                Text(!slot.isSeconds && slot.weightKg <= 0 ? "Log bodyweight · 0 kg" : slot.isWarmup ? "Log warm-up" : "Log set")
                    .font(.system(size: !slot.isSeconds && slot.weightKg <= 0 ? 14 : 17, weight: .black, design: .rounded))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(VoltSlab(fill: !slot.isSeconds && slot.weightKg <= 0 ? .orange : Volt.lime))
            if slot.isWarmup {
                // Warm or not is his call — the card never traps him on it.
                Button("skip warm-up") { store.skipWarmup() }
                    .buttonStyle(.plain)
                    .voltMono(11)
                    .foregroundStyle(.white.opacity(0.7))
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
                    .voltMono(11)
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
            VoltFlag(text: "Rest", ground: Volt.lime, ink: .black)
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
                    .voltMono(11)
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            Button { store.skipRest() } label: {
                Text("Skip")
                    .voltMono(13, .heavy)
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(VoltOutline(ink: Volt.lime))
            // He walks to the next machine DURING the rest — this is where
            // "it's taken" is discovered, so the switch lives here too. The
            // machine AT RISK is the one he is walking to (the slot that is
            // up next), not the one a switch would land him on.
            if store.pendingMachineCount > 1, store.nextMachineName != nil,
               let walkingTo = store.currentSlot?.exerciseName {
                Button { store.switchMachineFromRest() } label: {
                    Text("\(walkingTo) taken? ›")
                        .voltMono(11)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.7))
            }
            // '+1 set' — only after a below-cap rating on a machine that
            // allows it, once per machine (trainer ruling 2). Recording, not
            // a suggestion: the extra set is simply next.
            if let name = store.extraSetOfferName {
                Button { store.addExtraSet() } label: {
                    Text("+1 set · \(name)")
                        .voltMono(11, .heavy)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(VoltOutline(ink: Volt.lime))
            }
            if store.undoableSet != nil {
                Button { store.undoLastSet() } label: {
                    Text("undo last set")
                        .voltMono(11)
                        .frame(maxWidth: .infinity, minHeight: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.7))
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
    /// The RPE meanings survive on both grounds (CLAUDE.md); bright fills
    /// under black ink.
    private let tints: [Color] = [
        Color(red: 0x30 / 255, green: 0xD1 / 255, blue: 0x58 / 255),
        Color(red: 0x2D / 255, green: 0xD4 / 255, blue: 0xBF / 255),
        Color(red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255),
        Color(red: 0xFF / 255, green: 0x45 / 255, blue: 0x3A / 255),
    ]

    var body: some View {
        ScrollView {
        VStack(spacing: 5) {
            Text(exerciseName)
                .voltMono(11, .heavy)
                .foregroundStyle(Volt.lime)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            VoltFlag(text: "How hard?", ground: .white, ink: .black)
            // Every button always tappable: the cap is a prescription for
            // how hard the set SHOULD be, never a limit on reporting how
            // hard it WAS — a censored Grind during a ramp week is exactly
            // the signal that slows the ramp (trainer review, blocking).
            let cap = store.session?.rpeCap ?? 4
            if cap < 4 {
                // "Ramp target" only while the ramp scales loads; at 100% the
                // cap is the chart's effort ceiling, not a ramp.
                Text("\((store.session?.loadPct ?? 100) < 100 ? "Ramp target" : "Ceiling"): ≤ \(labels[cap - 1])")
                    .voltMono(10)
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
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(VoltSlab(fill: tints[i].opacity(i + 1 > cap ? 0.55 : 1)))
            }
            // An unrated exercise is honest data too — never force a tap.
            Button("skip") { store.skipRPE() }
                .buttonStyle(.plain)
                .voltMono(11)
                .foregroundStyle(.white.opacity(0.7))
            // A mis-logged last set: take it back before rating it.
            Button("undo last set") { store.undoLastSet() }
                .buttonStyle(.plain)
                .voltMono(11)
                .foregroundStyle(.white.opacity(0.7))
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
                VoltFlag(text: "Session", ground: Volt.lime, ink: .black)
                Text("\(working.count) sets · \(mins) min")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .textCase(.uppercase)
                ForEach(topWeights, id: \.0) { name, w in
                    HStack {
                        Text(name).voltMono(10).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                        Spacer()
                        Text("\(kg(w)) kg")
                            .font(.system(size: 13, weight: .black, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Volt.lime)
                    }
                }
                if let n = store.notice {
                    Text(n)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
                // "End" can be taken back: pending sets are still there. It
                // comes FIRST, well clear of Finish — 6 pt below the one button
                // that cannot be undone was a chalky-thumb trap (review DT-3).
                if let next = store.currentSlot {
                    Button { store.backToSet() } label: {
                        Text("Back to \(next.exerciseName)")
                            .voltMono(12, .heavy)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .padding(.horizontal, 6)
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(VoltOutline())
                    .padding(.bottom, 10)
                }
                Button {
                    Task { await store.finish() }
                } label: {
                    Text("Finish & save")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, minHeight: 42)
                }
                .buttonStyle(VoltSlab())
                if let name = store.extraSetOfferName {
                    Button { store.addExtraSet() } label: {
                        Text("+1 set · \(name)")
                            .voltMono(11, .heavy)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(VoltOutline(ink: Volt.lime))
                }
                if store.undoableSet != nil {
                    Button("undo last set") { store.undoLastSet() }
                        .buttonStyle(.plain)
                        .voltMono(11)
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                // Always offered: a test run with logged sets needs a way
                // out that isn't "save it into the training history". Asks
                // first — one tap used to throw the session away.
                Button {
                    if store.session?.logged.isEmpty ?? true { store.discard() } else { confirmDiscard = true }
                } label: {
                    Text(working.isEmpty ? "Discard" : "Discard — don't save")
                        .voltMono(11, .heavy)
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(VoltOutline(ink: Color(red: 0xFF / 255, green: 0x45 / 255, blue: 0x3A / 255)))
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
        case .saved, .merged: return ("checkmark.square.fill", Volt.lime)
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
                .voltMono(12, .heavy)
                .multilineTextAlignment(.center)
            Button { store.reset() } label: {
                Text("Done")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, minHeight: 42)
            }
            .buttonStyle(VoltSlab())
        }
    }
}
