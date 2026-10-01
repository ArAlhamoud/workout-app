// Home/Lock Screen widget refresh.
//
// The verdict widget refetches /api/verdict on a 30-minute timeline, so on
// its own it keeps saying "Train today" for up to half an hour after the
// session is saved. This asks WidgetKit to reload now.
//
// Same contract as native-live-activity.ts: a no-op outside the Capacitor
// shell, and ALSO on an installed binary that predates `reloadWidgets` — the
// web deploys to the phone at once, the native build does not. Failures are
// swallowed: the timeline still refreshes on its own.

import { isNativeApp } from './native-health';

interface WidgetReloadPlugin {
  reloadWidgets?: () => Promise<void>;
}

export function reloadWidgets(): void {
  try {
    if (!isNativeApp()) return;
    const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    const plugin = cap?.Plugins?.RestActivity as WidgetReloadPlugin | undefined;
    if (typeof plugin?.reloadWidgets !== 'function') return;
    void Promise.resolve(plugin.reloadWidgets()).catch(() => {});
  } catch {
    // An older bridge may throw synchronously on an unknown method.
  }
}
