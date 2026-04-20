'use client';

import { useState, useEffect } from 'react';

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => setSwReady(true));
    }

    // Show install hint on iOS Safari (not already installed as PWA)
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
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-lg mx-auto animate-fade-in">
      <div className="bg-gray-800 border border-gray-600 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-lg">W</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">
              Install for Apple Watch notifications
            </p>
            <p className="text-gray-400 text-xs mt-1 leading-relaxed">
              Add to Home Screen to get rest timer alerts on your wrist.
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="bg-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 flex items-center gap-1">
                <span className="text-base leading-none">⎙</span> Share
              </span>
              <span className="text-gray-600 text-xs">→</span>
              <span className="bg-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 flex items-center gap-1">
                <span className="text-base leading-none">⊕</span> Add to Home Screen
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.setItem('install-dismissed', '1');
              setVisible(false);
            }}
            className="text-gray-500 hover:text-white text-xl leading-none flex-shrink-0 mt-0.5"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
