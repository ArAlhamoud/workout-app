// SOURCE OF TRUTH. ios/App/App/GymGeofencePlugin.swift is a copy the Xcode
// target compiles; `npm run ios:deploy` overwrites it from this file. Edit here.

import Foundation
import Capacitor
import UIKit

/// The web card's handle on automatic gym check-in (GymGeofenceManager.swift).
/// Settings only: the region events, the prompts and the sends never go
/// through here, because the webview is not there when they happen.
///
/// Registered from the app target via `MainViewController`.
@objc(GymGeofencePlugin)
public class GymGeofencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GymGeofence"
    public let jsName = "GymGeofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlways", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGym", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearGym", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    /// Every authorization change reaches the card as "statusChange": the
    /// Always answer arrives after requestAlways has resolved.
    public override func load() {
        DispatchQueue.main.async {
            GymGeofence.shared.onStatusChange = { [weak self] in
                self?.notifyListeners("statusChange", data: GymGeofence.shared.status())
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(GymGeofence.shared.status()) }
    }

    @objc func requestAlways(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            GymGeofence.shared.requestAlways { _ in call.resolve(GymGeofence.shared.status()) }
        }
    }

    @objc func setGym(_ call: CAPPluginCall) {
        guard let gym = call.getString("gym"), GymGeofence.gyms.contains(gym) else {
            return call.reject("gym must be bfit or work")
        }
        DispatchQueue.main.async {
            GymGeofence.shared.setGym(gym) { accuracy, error in
                if let error { return call.reject(error) }
                call.resolve(["ok": true, "accuracyM": accuracy ?? 0])
            }
        }
    }

    @objc func clearGym(_ call: CAPPluginCall) {
        guard let gym = call.getString("gym"), GymGeofence.gyms.contains(gym) else {
            return call.reject("gym must be bfit or work")
        }
        DispatchQueue.main.async {
            GymGeofence.shared.clearGym(gym)
            call.resolve(GymGeofence.shared.status())
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }
}
