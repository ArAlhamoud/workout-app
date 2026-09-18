import CoachClient from './CoachClient';

// Server shell: the page itself is a client component, and a statically
// prerendered route bakes the nav's no-database fallback ("First dose")
// into its HTML forever (device-tester, 2026-09-18). Dynamic, like every
// other screen that shows the nav.
export const dynamic = 'force-dynamic';

export default function CoachPage() {
  return <CoachClient />;
}
