'use server';

// The iCloud backup's data source. Same-origin server action, so the native
// shell gets the full history with no token — the CloudBackup plugin writes
// it to the app's iCloud Drive folder, where Files.app can show it.

import { buildExportPayload } from '@/lib/export-data';

/** The complete history as a JSON string, ready to hand to the native side. */
export async function exportHistoryJson(): Promise<string> {
  return JSON.stringify(await buildExportPayload());
}
