// Daily iCloud Drive backup — native shell only, silent by contract.
//
// Once per local day, on app open: pull the full history through the
// same-origin export action and hand it to the CloudBackup plugin, which
// writes workout-backup.json into the app's iCloud Drive folder. Every
// failure mode (web build, old native binary without the plugin, signed out
// of iCloud, network down) is a quiet no-op — Neon and the GitHub snapshots
// are still the first two copies, and a backup layer must never surface
// errors the owner cannot act on mid-session.

import { isNativeApp } from './native-health';
import { exportHistoryJson } from '@/app/backup-actions';

const STAMP_KEY = 'cloud-backup-last-day';

interface CloudBackupPlugin {
  saveBackup(options: { json: string }): Promise<{ saved?: boolean; reason?: string }>;
}

function plugin(): CloudBackupPlugin | undefined {
  if (!isNativeApp()) return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.CloudBackup as CloudBackupPlugin | undefined;
}

/** Local calendar day — the throttle unit. A backup per day is plenty. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runCloudBackup(): Promise<void> {
  const cloud = plugin();
  if (!cloud) return;
  try {
    if (localStorage.getItem(STAMP_KEY) === today()) return;
    const json = await exportHistoryJson();
    const result = await cloud.saveBackup({ json });
    // Stamp only on success: a signed-out day retries tomorrow-or-next-open
    // instead of silently skipping a month.
    if (result?.saved) localStorage.setItem(STAMP_KEY, today());
  } catch {
    /* next open retries */
  }
}
