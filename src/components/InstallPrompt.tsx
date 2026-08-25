'use client';

import { useState, useEffect } from 'react';
import { isNativeApp } from '@/lib/native-health';

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }

    // The Capacitor shell does NOT report display-mode: standalone, so without
    // this the banner appears inside the installed native app and tells you to
    // install it — while covering the bottom of every screen.
    if (isNativeApp()) return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('install-dismissed');
    if (isIOS && !isStandalone && !dismissed) {
      const t = setTimeout(() => setVisible(true), 15000);
      return () => clearTimeout(t);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-lg mx-auto animate-fade-in print:hidden">
      <div className="glass-overlay border border-app-border rounded-card-lg p-4 shadow-card-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-[#99f6e4] to-[#a5b4fc] shadow-[0_0_20px_-6px_rgba(94,234,212,0.6)]">
            <span className="text-[#0b1120] font-round font-extrabold text-lg">W</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-app-tx1 font-semibold text-sm">
              Install for Apple Watch notifications
            </p>
            <p className="text-app-tx2 text-xs mt-1 leading-relaxed">
              Add to Home Screen to get rest timer alerts on your wrist.
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="bg-app-surface2 border border-app-border rounded-lg px-2.5 py-1.5 text-xs text-app-tx1 flex items-center gap-1">
                <span className="text-base leading-none">⎙</span> Share
              </span>
              <span className="text-app-tx3 text-xs">→</span>
              <span className="bg-app-surface2 border border-app-border rounded-lg px-2.5 py-1.5 text-xs text-app-tx1 flex items-center gap-1">
                <span className="text-base leading-none">⊕</span> Add to Home Screen
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.setItem('install-dismissed', '1');
              setVisible(false);
            }}
            className="text-app-tx3 hover:text-app-tx1 text-xl leading-none flex-shrink-0 mt-0.5"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
