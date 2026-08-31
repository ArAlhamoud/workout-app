import SwiftUI

@main
struct ARHealthWatchApp: App {
    @StateObject private var store = SessionStore.shared

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
        }
    }
}

extension SessionStore {
    /// One shared store so the Action Button intent and the UI drive the
    /// same session.
    static let shared = SessionStore()
}
