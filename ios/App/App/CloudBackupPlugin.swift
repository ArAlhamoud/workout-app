// SOURCE OF TRUTH. ios/App/App/CloudBackupPlugin.swift is a copy that the
// Xcode target compiles; `npm run ios:deploy` overwrites it from this file on
// every build. Edit here, never there.

import Foundation
import Capacitor

/// Writes the full-history JSON export into the app's iCloud Drive folder —
/// the third copy of the training record, after Neon and the GitHub
/// snapshots, and the only one tied to the owner's Apple ID instead of a
/// service. Visible in Files.app (NSUbiquitousContainers in Info.plist), so
/// its existence can be checked with a glance, not a debugger.
///
/// Failure is information, not an error: signed out of iCloud, or iCloud
/// Drive off for this app, resolves `{saved: false, reason: …}` and the web
/// layer stays quiet. The other two copies still stand.
@objc(CloudBackupPlugin)
public class CloudBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudBackup"
    public let jsName = "CloudBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveBackup", returnType: CAPPluginReturnPromise)
    ]

    private static let fileName = "workout-backup.json"

    @objc func saveBackup(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), !json.isEmpty else {
            return call.reject("json is required")
        }

        // Ubiquity URLs must be resolved off the main thread (Apple's own
        // documentation), and the write is file IO anyway.
        DispatchQueue.global(qos: .utility).async {
            guard let container = FileManager.default.url(forUbiquityContainerIdentifier: nil) else {
                call.resolve(["saved": false, "reason": "iCloud unavailable (signed out, or Drive off for this app)"])
                return
            }
            do {
                let documents = container.appendingPathComponent("Documents", isDirectory: true)
                try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
                let url = documents.appendingPathComponent(Self.fileName)
                // Atomic: the previous backup survives a mid-write kill.
                try Data(json.utf8).write(to: url, options: .atomic)
                call.resolve(["saved": true, "bytes": json.utf8.count])
            } catch {
                call.resolve(["saved": false, "reason": error.localizedDescription])
            }
        }
    }
}
