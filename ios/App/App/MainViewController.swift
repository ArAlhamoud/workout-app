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
    }
}
