'use client';

// The training/health domain switch. Training routes wear Volt (the
// design canvas's Direction B); everything else wears Aurora/Chroma.
// A pre-paint inline script in the root layout sets the attribute for
// hard loads; this component keeps it correct across client-side
// navigation. The regex is duplicated there — change both together.

import { usePathname } from 'next/navigation';
import { useLayoutEffect } from 'react';

export const VOLT_ROUTES = /^\/(train|program|stats|workouts|progress|exercises)(\/|$)/;

export default function DomainTheme() {
  const pathname = usePathname();
  // useLayoutEffect, not useEffect: the swap must land before paint or a
  // client-side hop between domains flashes the wrong ground full-screen.
  useLayoutEffect(() => {
    const el = document.documentElement;
    if (VOLT_ROUTES.test(pathname ?? '')) el.dataset.domain = 'volt';
    else delete el.dataset.domain;
  }, [pathname]);
  return null;
}
