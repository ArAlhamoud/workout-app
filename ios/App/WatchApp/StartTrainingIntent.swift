import AppIntents
import SwiftUI

/// The Action Button press: plan fetched, HK session started, first set
/// card up — zero taps on screen (docs/WATCH.md). Also answers Siri via the
/// App Shortcut phrase below.
struct StartTrainingIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Training"
    static let description = IntentDescription("Fetch today's plan and start the session.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        let store = SessionStore.shared
        // The session file is already loaded (SessionStore.init), so a press
        // during a session — even a cold launch — finds it and leaves it
        // where it stands. With none on the wrist, a session open on the
        // PHONE is continued rather than split in two.
        if store.session == nil {
            await store.startFromButton()
        }
        return .result()
    }
}

/// "Done in AR Health": log the set on the card, as shown, unrated. The
/// reply says what was logged, the rest and what is next — hands-free
/// between sets without replacing the card (owner's backlog, 2026-09-18).
/// Siri on the watch needs the phrase spoken exactly, app name included.
struct LogSetIntent: AppIntent {
    static let title: LocalizedStringResource = "Log Set"
    static let description = IntentDescription("Log the set on the watch card exactly as shown, unrated.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let line = SessionStore.shared.voiceLog()
        return .result(dialog: "\(line)")
    }
}

/// "What's next in AR Health": read-only.
struct WhatsNextIntent: AppIntent {
    static let title: LocalizedStringResource = "What's Next"
    static let description = IntentDescription("Say the next set on the watch.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let line = SessionStore.shared.voiceStatus()
        return .result(dialog: "\(line)")
    }
}

struct ARHealthShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartTrainingIntent(),
            phrases: [
                "Start my workout in \(.applicationName)",
                "Start training in \(.applicationName)",
            ],
            shortTitle: "Start Training",
            systemImageName: "dumbbell.fill"
        )
        AppShortcut(
            intent: LogSetIntent(),
            phrases: [
                "Done in \(.applicationName)",
                "Log set in \(.applicationName)",
            ],
            shortTitle: "Log Set",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: WhatsNextIntent(),
            phrases: [
                "What's next in \(.applicationName)",
            ],
            shortTitle: "What's Next",
            systemImageName: "list.bullet"
        )
    }
}
