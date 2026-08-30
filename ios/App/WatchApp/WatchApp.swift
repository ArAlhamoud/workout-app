import SwiftUI

@main
struct ARHealthWatchApp: App {
    @StateObject private var store = SessionStore.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .onAppear { store.onLaunch() }
        }
    }
}

extension SessionStore {
    /// One shared store so the Action Button intent and the UI drive the
    /// same session.
    static let shared = SessionStore()
}
