import SwiftUI

@main
struct ARHealthWatchApp: App {
    @StateObject private var store = SessionStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            // NavigationStack is what makes .toolbar items actually render
            // on watchOS — without it the End button silently vanished and
            // a card with a disabled Log button became a trap.
            NavigationStack {
                RootView()
            }
            .environmentObject(store)
            .onAppear { store.onLaunch() }
            // Wrist-raise / return from the clock: learn what the phone did
            // meanwhile (a session to continue, or ours finished there).
            .onChange(of: scenePhase) { _, p in
                if p == .active { Task { await store.refreshLive() } }
            }
        }
    }
}

extension SessionStore {
    /// One shared store so the Action Button intent and the UI drive the
    /// same session.
    static let shared = SessionStore()
}
