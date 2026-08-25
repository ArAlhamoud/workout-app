'use client';

// window.print() needs a client boundary; the report page itself stays a
// server component. Honest limit: inside the Capacitor shell there is no
// print handler — window.print() is a silent no-op in WKWebView
// (device-tester). Until a native share lands via a Mac trip, the shell
// shows how to get the PDF instead of a button that does nothing.

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/native-health';

export default function PrintButton() {
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);

  if (native) {
    return (
      <p className="max-w-[150px] flex-none text-right text-[10px] leading-snug text-app-tx3">
        To print or save PDF, open this page in Safari.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex-none rounded-card border border-acc-cyan/40 bg-acc-cyan/10 px-4 py-2 text-xs font-bold text-acc-cyan"
    >
      Print / PDF
    </button>
  );
}
