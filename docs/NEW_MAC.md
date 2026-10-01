# Moving the Mac session to a new Mac

Written 2026-09-27, when the owner moved from the MacBook Air M1 to a Mac
mini. The code, data and history are on GitHub; the site and its secrets are
on Vercel; signing lives in App Store Connect. The old Mac holds only a
handful of things, and one of them cannot be recreated.

## 0. First: the one file you cannot get back

`~/.appstoreconnect/private_keys/AuthKey_Q4C9KQJY37.p8`. This is the App
Store Connect API key that every headless build and every TestFlight upload
signs with (`scripts/ios-deploy.sh`, `scripts/testflight-upload.sh`). Apple
lets you download it only once. Copy it to the new Mac at the same path, by
AirDrop or USB, never through git or iCloud. Then run `chmod 600` on it. If
it is ever lost, make a new key in App Store Connect and update the key ID in
BOTH scripts, because each one hardcodes it.

## 1a. The easy route: Migration Assistant, Mac to Mac

Both Macs are Apple Silicon, so run Migration Assistant from the old Mac
during the new Mac's first setup. There is no Time Machine backup, so it
has to go Mac to Mac.

- **Do not create an `ar` account first.** Let the migration create it. The
  short username and the repo path (`/Users/ar/Desktop/Ar Workout`) are what
  Claude's memory folder is keyed by.
- It carries:
  - the login keychain: the GitHub push token and the Apple Development
    certificate;
  - `~/.appstoreconnect`, `~/.claude` (memory), `~/.gem` (xcodeproj) and
    `~/Library/Python` (pyjwt);
  - the repo itself.
- Afterwards, do these by hand:
  1. Open Xcode once and let it install its components. Check Settings →
     Components for the **iOS and watchOS** platforms, and download them
     if they are missing (about 12 GB).
  2. In the repo, delete `ios/App/.derived*`, then run `npm ci`.
  3. Run `brew doctor`.
  4. Sign in to the Claude app again.

## 1b. The clean route

1. **Xcode 27** from the App Store (27.0 is proven on the Mac mini,
   2026-10-02, with the iOS 27 and watchOS 27 runtimes). Then run:
   - `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
   - `sudo xcodebuild -license accept`
   - `xcodebuild -runFirstLaunch`
   - `xcodebuild -downloadPlatform iOS`
   - `xcodebuild -downloadPlatform watchOS`

   The App scheme builds the Watch app too, so watchOS is not optional.
2. **Node 24** (CI pins 24), from nodejs.org or `brew install node@24`.
   There is no version manager and no `.nvmrc`.
3. **Push access:** run `brew install gh`, then `gh auth login` (HTTPS,
   and answer yes to "authenticate Git"). A hand-made token needs the
   `workflow` scope, because `.github/workflows` changes often.
4. Run `git config --global user.name`, then `git config --global user.email`.
   These are unset on the old Mac, so its commits read
   `AR <ar@MacBook-Air-3.local>`. The Mac mini uses `ArAlhamoud` and
   `87267024+ArAlhamoud@users.noreply.github.com`, the address GitHub's
   web commits already use.
5. Clone to exactly `/Users/ar/Desktop/Ar Workout`, using
   `https://github.com/ArAlhamoud/workout-app.git`. Keep the path free of
   apostrophes, which once broke `next build`.
6. Put the `.p8` from step 0 in place.
7. **Claude app:**
   - Sign in.
   - Turn on Settings → Claude Code → Enable remote control by default.
   - Copy the old Mac's `~/.claude/projects/-Users-ar-Desktop-Ar-Workout/memory/`
     to the same path.
   - Optionally copy `~/.claude/settings.json` and the repo's gitignored
     `.claude/settings.local.json`.
8. Install these only when you need them:
   - `/usr/bin/gem install --user-install xcodeproj`, for scripted pbxproj
     edits. Always run it with `/usr/bin/ruby`, never Homebrew's Ruby 4.
   - `/usr/bin/python3 -m pip install --user pyjwt cryptography`, for App
     Store Connect API checks.

**Nothing to set up for these:**
- **`.env`:** none exists. DATABASE_URL and the sync token live in Vercel
  and the GitHub Actions secrets.
- **Vercel or Neon CLIs:** not needed. A push to `main` deploys.
- **npm's install-script prompt:** npm 11 skips dependency install
  scripts (prisma, @prisma/engines, @prisma/client, unrs-resolver,
  fsevents) and warns about it after `npm ci`. Ignore the warning.
  `npm test` runs `prisma generate` itself, and tests and builds pass
  without the scripts. Do not add `allowScripts` to `package.json`.
- **CocoaPods:** not needed. Capacitor comes through SwiftPM from
  `node_modules`, so run `npm ci` before the first Xcode build.
- **A distribution certificate:** not needed. It is cloud-managed through
  the API key.
- **Provisioning profiles:** they regenerate. Never copy them; stale ones
  caused "Could not install at this time".

## 2. Prove the new Mac works, without touching the phone

```
npm ci
npm test
npm run test:watch
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/App/.derived-sim build
```

For signing, run the `xcodebuild` block from `scripts/ios-deploy.sh` with
`-destination 'generic/platform=iOS'` instead of the phone's id. It should
mint this Mac's own development certificate through the key. The first real
`npm run ios:testflight` proves the rest. Never upload a build just to test,
because every upload uses up a build number.

## 3. Do not

- **Do not run `npm run ios:deploy` to "try" the new Mac.** It installs on
  his real iPhone by default (`WORKOUT_DEVICE_ID` overrides that). A dev
  install replaces the TestFlight copy, and TestFlight updates stop arriving.
  Native changes reach the phone and Watch through `npm run ios:testflight`.
- **Do not turn on iCloud "Desktop & Documents".** The repo lives on the
  Desktop, and gigabytes of `node_modules` and `.derived` output would sync
  or get evicted mid-build.
- **Do not copy** `node_modules`, `.next`, `ios/App/.derived*`,
  `ios/App/.archive` or `~/Library/Developer/Xcode/DerivedData`.
- **Keep 15 GB free.** Builds have failed below that. Budget about 35 GB
  for Xcode, the two runtimes, simulators, `node_modules` and derived data.

## 4. Per-Mac things that re-pair themselves

- **iPhone and Watch:** they are only needed for dev installs. Plug the
  phone in by USB, unlock it, tap Trust, and open Xcode once. The Watch
  appears only through a wired, trusted phone the first time. Both devices
  stay registered on the team.
- **Simulators:** they come back with new UDIDs. Use the **iPhone 17** and
  **Apple Watch Ultra 3 (49mm)**, then update the UDID in the memory note
  `sim-testing-preview-branches`. Claude's simulator tool asks for access
  once per new simulator.
- **macOS privacy prompts:** Local Network for Xcode and devicectl, and
  anything Claude's tools request. Approve each one the first time.

## 5. Two Macs at once

Claude's memory is per Mac and does not sync between them. Choose one Mac
for the Mac session; `CLAUDE.md` and `docs/` are what both Macs share. The
cloud session is unaffected.
