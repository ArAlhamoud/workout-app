import type { Viewport } from 'next';

// Volt domain: black browser/PWA chrome. Merges over the root viewport
// (width/scale/viewportFit survive); the native shell's status bar is
// its own animal — verify on the simulator (rule 3).
export const viewport: Viewport = { themeColor: '#050505' };

export default function VoltLayout({ children }: { children: React.ReactNode }) {
  return children;
}
