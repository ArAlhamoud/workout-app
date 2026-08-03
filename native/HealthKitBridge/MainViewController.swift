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
    }
}
