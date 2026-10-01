// The Home/Lock Screen verdict: what the app would say if he glanced at it.
//
// Renders /api/verdict and nothing else — the endpoint was designed as "the
// glance rule in miniature" (a lead, a day letter, a days-since number), so
// the widget does zero computation of its own. If `updatedISO` is older than
// 24 h the numbers are stale enough to mislead, and a wrong "TRAIN TODAY" on
// the Lock Screen costs trust — show a dash instead (docs/MAC_NATIVE_TRIP.md).

import SwiftUI
import WidgetKit

// MARK: - Verdict payload

struct Verdict: Decodable {
    let lead: String
    let day: String?
    let queuedDay: String?
    let daysSince: Int?
    let updatedISO: String

    /// The letter worth coloring: today's day if one is on, else the queued one.
    var dayLetter: String? { day ?? queuedDay }
}

enum VerdictFetcher {
    static let url = URL(string: "https://workout-app-gamma-rouge.vercel.app/api/verdict")!

    /// One bounded GET. No token — the guard came off with the health-sync
    /// token; this endpoint returns a glance, not history.
    static func fetch() async -> Verdict? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        // A reload asked for right after a save must not be answered from
        // URLSession's cache with the pre-session verdict.
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        guard let verdict = try? JSONDecoder().decode(Verdict.self, from: data) else { return nil }
        if !isStale(verdict) { VerdictCache.save(data) }
        return verdict
    }

    /// Stale by contract: updatedISO older than 24 h renders as a dash.
    static func isStale(_ verdict: Verdict, now: Date = Date()) -> Bool {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let updated = parser.date(from: verdict.updatedISO)
            ?? ISO8601DateFormatter().date(from: verdict.updatedISO)
        guard let updated else { return true }
        return now.timeIntervalSince(updated) > 24 * 60 * 60
    }
}

// MARK: - Last good verdict

/// The last verdict that was fetched fresh, kept in the widget extension's
/// own UserDefaults. One failed fetch (lift, basement gym, flight mode) used
/// to replace a good verdict with a dash for a whole cycle.
enum VerdictCache {
    private static let dataKey = "verdict.lastGood.json"
    private static let savedAtKey = "verdict.lastGood.savedAt"
    /// Past this the cached line says nothing true any more — back to a dash.
    private static let maxAge: TimeInterval = 24 * 60 * 60

    static func save(_ data: Data, now: Date = Date()) {
        let defaults = UserDefaults.standard
        defaults.set(data, forKey: dataKey)
        defaults.set(now.timeIntervalSince1970, forKey: savedAtKey)
    }

    /// The owner's activity day (04:00 Riyadh rollover = 01:00 UTC), as a
    /// day number. The verdict changes when that day turns, so a verdict
    /// cached on another day says nothing true: "done today" cached at
    /// 23:00 was still showing at 09:00 (adversary, 2026-10-02).
    private static func activityDay(_ t: TimeInterval) -> Int {
        Int(((t - 3600) / 86_400).rounded(.down))
    }

    /// The cached verdict, only while it is from today's activity day.
    static func load(now: Date = Date()) -> Verdict? {
        let defaults = UserDefaults.standard
        guard let data = defaults.data(forKey: dataKey),
              let verdict = try? JSONDecoder().decode(Verdict.self, from: data)
        else { return nil }
        let savedAt = defaults.double(forKey: savedAtKey)
        let age = now.timeIntervalSince1970 - savedAt
        guard age >= 0, age <= maxAge,
              activityDay(savedAt) == activityDay(now.timeIntervalSince1970)
        else { return nil }
        return verdict
    }
}

// MARK: - Timeline

struct VerdictEntry: TimelineEntry {
    let date: Date
    /// nil = no data yet (nothing fetched and nothing cached, or stale) → dash.
    let verdict: Verdict?
    /// The fetch behind this entry failed: `verdict` is the cached one and is
    /// drawn dimmed, without its day count — a session saved since would
    /// have changed it. Also retries sooner than the usual cycle.
    var fetchFailed: Bool = false
}

struct VerdictProvider: TimelineProvider {
    func placeholder(in context: Context) -> VerdictEntry {
        VerdictEntry(
            date: Date(),
            verdict: Verdict(lead: "Train today", day: "B", queuedDay: nil, daysSince: 1,
                             updatedISO: ISO8601DateFormatter().string(from: Date()))
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (VerdictEntry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(await entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<VerdictEntry>) -> Void) {
        Task {
            let entry = await entry()
            // 30 min is fresh enough for a verdict that changes at most twice a
            // day (a session logged, a recovery day passing at midnight), and
            // cheap enough that WidgetKit's daily refresh budget never bites.
            // A saved workout does not wait for it: the app calls
            // WidgetCenter.reloadAllTimelines (RestActivityPlugin.reloadWidgets).
            let next = Date().addingTimeInterval((entry.fetchFailed ? 10 : 30) * 60)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func entry() async -> VerdictEntry {
        if let verdict = await VerdictFetcher.fetch() {
            // The server answered. A stale updatedISO from it is still a dash.
            return VerdictEntry(date: Date(), verdict: VerdictFetcher.isStale(verdict) ? nil : verdict)
        }
        // Unreachable: today's last good verdict, drawn as unconfirmed.
        return VerdictEntry(date: Date(), verdict: VerdictCache.load(), fetchFailed: true)
    }
}

// MARK: - Aurora palette (mirrors src/app/globals.css tokens)

enum Aurora {
    static let violet = Color(red: 0.655, green: 0.545, blue: 0.98)   // Day A
    static let teal = Color(red: 0.176, green: 0.831, blue: 0.749)    // Day B
    static let bg = Color(red: 0.043, green: 0.055, blue: 0.102)      // app background
    static let tx2 = Color.white.opacity(0.72)
    static let tx3 = Color.white.opacity(0.45)

    static func dayColor(_ letter: String?) -> Color {
        letter == "A" ? violet : teal
    }
}

// MARK: - Views

struct VerdictSmallView: View {
    let entry: VerdictEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let v = entry.verdict {
                HStack(alignment: .top) {
                    // The day letter is the anchor — same violet/teal code the
                    // whole app uses, so A and B read at a glance.
                    Text(v.dayLetter ?? "–")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(Aurora.dayColor(v.dayLetter))
                    Spacer()
                    // An old cached verdict's day count is wrong by now.
                    if !entry.fetchFailed, let days = v.daysSince {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text("\(days)")
                                .font(.system(size: 17, weight: .semibold, design: .rounded))
                                .foregroundStyle(Aurora.tx2)
                            Text(days == 1 ? "day" : "days")
                                .font(.system(size: 9, weight: .bold))
                                .textCase(.uppercase)
                                .foregroundStyle(Aurora.tx3)
                        }
                    }
                }
                Spacer(minLength: 0)
                if entry.fetchFailed {
                    Text("offline")
                        .font(.system(size: 9, weight: .bold))
                        .textCase(.uppercase)
                        .foregroundStyle(Aurora.tx3)
                }
                Text(v.lead)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(entry.fetchFailed ? Aurora.tx2 : .white)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
            } else {
                // Stale or unreachable: a dash, never a wrong instruction.
                Text("—")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(Aurora.tx3)
                Spacer(minLength: 0)
                Text("Open the app")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Aurora.tx3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) {
            // Opaque base FIRST: an alpha gradient alone composites over the
            // system's light widget material and comes out silver, not Aurora.
            Aurora.bg
            LinearGradient(
                colors: [.clear, Aurora.dayColor(entry.verdict?.dayLetter).opacity(0.28)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        }
    }
}

struct VerdictRectangularView: View {
    let entry: VerdictEntry

    var body: some View {
        // Lock Screen accessory: monochrome by platform, so hierarchy has to
        // come from weight, not color.
        VStack(alignment: .leading, spacing: 1) {
            if let v = entry.verdict {
                HStack(spacing: 4) {
                    Text("DAY \(v.dayLetter ?? "–")")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                    if entry.fetchFailed {
                        // A cached verdict: a session saved since would have
                        // changed its day count, so the mark replaces it.
                        Text("· offline")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .opacity(0.7)
                    } else if let days = v.daysSince {
                        Text("· \(days)d")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .opacity(0.7)
                    }
                }
                Text(v.lead)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(2)
                    .opacity(0.85)
            } else {
                Text("—")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { Color.clear }
    }
}

struct VerdictCircularView: View {
    let entry: VerdictEntry

    var body: some View {
        // One glyph: the day letter. The number lives in the rectangular
        // family; cramming both into a circle served neither.
        ZStack {
            Circle().stroke(.white.opacity(0.25), lineWidth: 3)
            Text(entry.verdict?.dayLetter ?? "—")
                .font(.system(size: 20, weight: .bold, design: .rounded))
        }
        .containerBackground(for: .widget) { Color.clear }
    }
}

// MARK: - Widget

struct VerdictWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VerdictWidget", provider: VerdictProvider()) { entry in
            VerdictEntryView(entry: entry)
        }
        .configurationDisplayName("Today's Verdict")
        .description("Train or recover, which day, and how long it's been.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryCircular])
    }
}

struct VerdictEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: VerdictEntry

    var body: some View {
        switch family {
        case .accessoryRectangular: VerdictRectangularView(entry: entry)
        case .accessoryCircular: VerdictCircularView(entry: entry)
        default: VerdictSmallView(entry: entry)
        }
    }
}
