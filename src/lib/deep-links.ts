// Deep-link routing: pure string → route, no React, no Capacitor.
//
// Lives in lib (not in the component) because links are untrusted input and
// the allowlist deserves assertions — scripts/coach-tests.ts imports this
// directly, which a component file cannot offer the plain ts-node runner.

const TABS: Record<string, string> = {
  home: '/',
  stats: '/stats',
  history: '/workouts',
  program: '/program',
};

/** The domain the app itself is served from (capacitor.config server.url). */
const APP_HOST = 'workout-app-gamma-rouge.vercel.app';

/**
 * Screens a universal link may open. Prefix-matched per segment, so
 * /workouts/abc123 and /progress/xyz work, but /api/export does not — a
 * tapped export link should download in Safari, never swallow itself into
 * the app.
 */
const LINKABLE_PREFIXES = ['/', '/workouts', '/stats', '/program', '/coach', '/exercises', '/progress'];

function routeForUniversalLink(url: URL): string | null {
  if (url.hostname.toLowerCase() !== APP_HOST) return null;
  const path = url.pathname === '' ? '/' : url.pathname;
  const ok = LINKABLE_PREFIXES.some(
    (p) => path === p || (p !== '/' && path.startsWith(`${p}/`)),
  );
  if (!ok) return null;
  return `${path}${url.search}`;
}

export function routeForDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return routeForUniversalLink(url);
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
