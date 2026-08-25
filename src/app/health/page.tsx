// The health hub IS Home now (the owner's re-orientation): the app is a
// health tracker with training as one section. This route survives for
// old links, notification routes and muscle memory.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function HealthPage() {
  redirect('/');
}
