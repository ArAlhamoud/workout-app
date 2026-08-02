'use client';

// Turns `workout://…` links into in-app navigation. Renders nothing.
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
//
// Anything else is ignored on purpose. A URL scheme is untrusted input — any
// app or web page can fire one — so links map onto a fixed allowlist rather
// than being treated as a path.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/native-health';

const TABS: Record<string, string> = {
  home: '/',
  stats: '/stats',
  history: '/workouts',
  program: '/program',
};

export function routeForDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'workout:') return null;

  const host = url.hostname.toLowerCase();

  // /workouts/new restores the saved draft on mount, so resume needs no params.
  if (host === 'resume') return '/workouts/new';

  if (host === 'start') {
    const day = url.searchParams.get('day')?.toUpperCase();
    const dur = url.searchParams.get('dur');
    const params = new URLSearchParams();
    if (day === 'A' || day === 'B') params.set('day', day);
    // Durations are a fixed set in the UI; anything else falls back to the
    // plain new-workout screen rather than being passed through.
    if (dur === '30' || dur === '45' || dur === '60') params.set('dur', dur);
    const qs = params.toString();
    return qs ? `/workouts/new?${qs}` : '/workouts/new';
  }

  return TABS[host] ?? null;
}

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

    const result = app.addListener('appUrlOpen', ({ url }) => {
      const target = routeForDeepLink(url);
      if (target) router.push(target);
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

  return null;
}
