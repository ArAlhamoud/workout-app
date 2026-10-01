'use client';

// Turns `workout://…` links and universal links into in-app navigation.
// Renders nothing.
//
// The scheme is registered in ios/App/App/Info.plist, which is what lets
// Shortcuts, an NFC sticker, or a Home Screen shortcut launch straight into a
// session. Without this listener the app merely comes to the foreground.
//
// Supported:
//   workout://start?day=B&dur=30   → /workouts/new?day=B&dur=30
//   workout://start                → /workouts/new
//   workout://resume               → /workouts/new (picks the saved draft back up)
//   workout://stats | history | program | home
//   https://<the app's own domain>/<an app screen>  (universal links — the
//     associated-domains entitlement + public/.well-known/apple-app-site-association
//     make iOS hand these to the app instead of Safari)
//
// Anything else is ignored on purpose. Both a URL scheme and a universal link
// are untrusted input — any app or web page can fire one — so links map onto
// a fixed allowlist rather than being treated as a path.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/native-health';
import { reloadWidgets } from '@/lib/native-widgets';
import { routeForDeepLink } from '@/lib/deep-links';

interface UrlOpenEvent {
  url: string;
}
interface ListenerHandle {
  remove: () => void;
}
interface AppPlugin {
  addListener(
    event: 'appUrlOpen',
    cb: (event: UrlOpenEvent) => void,
  ): Promise<ListenerHandle> | ListenerHandle;
}

export default function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;

    // Read the plugin off the injected global rather than importing
    // @capacitor/app: a memoised dynamic import is what previously wedged the
    // Health bridge when a chunk fetch stalled.
    const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    const app = cap?.Plugins?.App as AppPlugin | undefined;
    if (!app) return;

    let handle: ListenerHandle | undefined;
    let cancelled = false;

    // The native shell re-sends a cold-launch link on a short ladder (1 to
    // 6.5 s) because the first send can beat this listener. Each rung was a
    // router.push: tap another room within those seconds and the later
    // rungs pulled him back. One link navigates once.
    let last: { target: string; at: number } | null = null;
    const result = app.addListener('appUrlOpen', ({ url }) => {
      const target = routeForDeepLink(url);
      if (!target) return;
      const now = Date.now();
      if (last && last.target === target && now - last.at < 10_000) return;
      last = { target, at: now };
      router.push(target);
    });

    Promise.resolve(result).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [router]);

  // The Home-screen verdict widget: reload it whenever the app comes to the
  // front (a Watch-finished session changes the verdict with no save here).
  // No-op off the phone and on a binary that predates the plugin method.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadWidgets();
    };
    onVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return null;
}
