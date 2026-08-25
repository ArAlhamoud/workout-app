import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Remote-mode shell: the native app loads the deployed Vercel PWA directly,
 * so `webDir` is unused (but must exist — `public/` satisfies the CLI).
 */
// Simulator testing of an unmerged branch: point one build at its Vercel
// preview with e.g. `CAP_SERVER_URL=https://<preview>.vercel.app npm run
// ios:deploy`. Unset, the shell targets production — the phone's build must
// only ever come from a deploy without the override.
const serverUrl = process.env.CAP_SERVER_URL ?? 'https://workout-app-gamma-rouge.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.aralhamoud.workout',
  appName: 'AR Health',
  webDir: 'public',
  server: {
    url: serverUrl,
    allowNavigation: [
      'workout-app-gamma-rouge.vercel.app',
      '*.vercel.app',
      'www.youtube.com',
      'youtube.com',
    ],
  },
  ios: {
    contentInset: 'never',
    // App-Bound Domains, the precondition for WKWebView running a service
    // worker in a remote-URL shell, are DECLARED in Info.plist but not yet
    // ENFORCED. Flipping this to true is the whole switch.
    //
    // Held off deliberately: enforcement restricts in-webview navigation to
    // WKAppBoundDomains, and today it would buy nothing — the precaching
    // service worker it exists to enable has not shipped yet — while risking
    // the YouTube links in allowNavigation above. Both YouTube hosts are
    // already listed in the plist so the switch is safe when the moment comes.
    // limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
