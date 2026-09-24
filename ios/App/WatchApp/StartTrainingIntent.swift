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
    }
}
