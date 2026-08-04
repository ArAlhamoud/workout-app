// Durable key-value storage: @capacitor/preferences (native UserDefaults)
// with a localStorage fallback on the plain web.
//
// Why not localStorage alone: in the native shell the WebView's localStorage
// belongs to the REMOTE origin and iOS may evict it under storage pressure —
// and when the page cannot load (no signal), nothing web-side is reachable at
// all. UserDefaults is neither evictable that way nor origin-scoped, and it
// rides device backups. Anything that must survive a bad night — the draft
// vault, the save outbox — lives here.

import { isNativeApp } from './native-health';

interface PreferencesPlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

function prefs(): PreferencesPlugin | undefined {
  if (!isNativeApp()) return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.Preferences as PreferencesPlugin | undefined;
}

export async function durableGet(key: string): Promise<string | null> {
  const p = prefs();
  if (p) {
    try {
      const { value } = await p.get({ key });
      return value;
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes to BOTH stores when native. localStorage stays the synchronous fast
 * path the UI reads; Preferences is the copy that survives eviction.
 */
export async function durableSet(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota — the durable copy below still lands */
  }
  const p = prefs();
  if (p) {
    try {
      await p.set({ key, value });
    } catch {
      /* nothing else to do; localStorage copy stands */
    }
  }
}

export async function durableRemove(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  const p = prefs();
  if (p) {
    try {
      await p.remove({ key });
    } catch {
      /* ignore */
    }
  }
}
