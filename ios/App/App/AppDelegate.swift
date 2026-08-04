import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Set when the app is launched cold by a Home-screen quick action. iOS
    /// delivers it in launchOptions and does NOT call performActionFor in that
    /// case, so it is held here until the webview exists to receive it.
    private var pendingShortcutURL: URL?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        requestNotificationAuthorization()

        if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            pendingShortcutURL = URL(string: item.type)
        }
        return true
    }

    // MARK: - Home-screen quick actions
    //
    // Each shortcut's type string IS a workout:// URL (see Info.plist), so the
    // whole feature is a forward into the same path the custom scheme already
    // uses. DeepLinkHandler.tsx maps it onto its allowlist web-side; nothing
    // here needs to know what "resume" or "start" mean.

    /// Warm launch: the app is already running, the webview is listening.
    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let url = URL(string: shortcutItem.type) else {
            completionHandler(false)
            return
        }
        completionHandler(ApplicationDelegateProxy.shared.application(application, open: url, options: [:]))
    }

    /// Cold launch: the shell is still fetching the web app from Vercel when the
    /// shortcut arrives, and an appUrlOpen fired before DeepLinkHandler mounts is
    /// simply dropped — there is no queue on the JS side to catch it.
    ///
    /// A single delayed send was tried first and lost the link on a real cold
    /// start, so this re-sends on a short ladder instead. Repeats are safe:
    /// the handler maps a URL onto a route and pushes it, so delivering the same
    /// link twice is the same navigation twice. The ladder is bounded — if every
    /// rung misses, the app has simply opened on Home.
    private static let shortcutDeliveryDelays: [TimeInterval] = [1.0, 2.2, 4.0, 6.5]

    private func deliverPendingShortcut() {
        guard let url = pendingShortcutURL else { return }
        pendingShortcutURL = nil
        for delay in Self.shortcutDeliveryDelays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
            }
        }
    }

    /// Local notifications (rest timers, session reminders) need an OS-level
    /// grant, and the web Notification API doesn't exist inside WKWebView — so
    /// the ask has to originate here. Local only: no APNs, no remote push.
    ///
    /// iOS shows this sheet once, ever. Declining is not fatal; scheduling
    /// simply no-ops until the user re-enables it in Settings.
    private func requestNotificationAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("[Workout] Notification authorization failed: \(error.localizedDescription)")
            } else {
                print("[Workout] Notification authorization granted: \(granted)")
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        deliverPendingShortcut()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
