// SOURCE OF TRUTH. ios/App/App/MainViewController.swift is a copy the Xcode
// target compiles; `npm run ios:deploy` overwrites it from this file. Edit here.

import UIKit
import Capacitor

/// App view controller that registers hand-rolled plugins with the Capacitor
/// bridge. `capacitorDidLoad()` is Capacitor's official hook for registering
/// plugins that live in the app target (Capacitor 6+).
///
/// Wire-up: in Main.storyboard, set the root view controller's Custom Class to
/// `MainViewController` with module `App` (see README.md in this folder).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitBridgePlugin())
        bridge?.registerPluginInstance(RestActivityPlugin())
        bridge?.registerPluginInstance(CloudBackupPlugin())
        bridge?.registerPluginInstance(GymGeofencePlugin())
        // The bridge has just made its NotificationRouter the notification
        // delegate: wrap it again so the gym prompt's actions are answered
        // here and every other notification still reaches the router.
        GymNotifications.shared.install()
    }

    /// iOS 26+ draws a "scroll edge effect" — a grey fade — over content that
    /// scrolls under the status bar and the bottom edge. It arrived with the
    /// first Xcode 27 build (2026-10-02) and the owner did not want it: "use
    /// the normal way of the old way". A web overlay was removed first on the
    /// wrong theory; the fade is UIKit's, so it is switched off here.
    override func viewDidLoad() {
        super.viewDidLoad()
        if #available(iOS 26.0, *), let scroll = webView?.scrollView {
            scroll.topEdgeEffect.isHidden = true
            scroll.bottomEdgeEffect.isHidden = true
        }
        NotificationCenter.default.addObserver(self, selector: #selector(recoverBlankPage),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        #if DEBUG
        // Debug-only: empty the page 6 s after launch, to test the recovery
        // below in the simulator (a failed background load cannot be staged).
        if UserDefaults.standard.bool(forKey: "SimulateBlankWebView") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { self.webView?.evaluateJavaScript("document.documentElement.replaceChildren(document.createElement('body'))") }
        }
        #endif
    }

    /// A black screen that never loads (owner, 2026-11-11: opening the gym
    /// check-in or check-out notification). iOS wakes the app in the
    /// background for a gym event; the page load started then can be cut off
    /// when the app is suspended, and Capacitor reloads only after a crashed
    /// web process — a failed load leaves an empty webview on the dark
    /// system background for good. Every time the app comes to the front:
    /// a page that is blank, never loaded, or whose web process is gone is
    /// loaded again. A live page is never touched.
    @objc private func recoverBlankPage() {
        guard let web = webView, !web.isLoading, let start = bridge?.config.appStartServerURL else { return }
        let reload = {
            NSLog("[Shell] blank page on foreground — reloading %@", start.absoluteString)
            web.load(URLRequest(url: start))
        }
        guard let url = web.url, url.scheme == "https" || url.scheme == "http" else { return reload() }
        web.evaluateJavaScript("document.body ? document.body.childElementCount : 0") { result, error in
            if error != nil || (result as? Int ?? 0) == 0 { reload() }
        }
    }
}
