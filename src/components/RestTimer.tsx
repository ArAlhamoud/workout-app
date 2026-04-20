'use client';

import { useEffect, useState, useRef } from 'react';

interface RestTimerProps {
  totalSeconds: number;
  exerciseName: string;
  onDismiss: () => void;
}

export default function RestTimer({ totalSeconds, exerciseName, onDismiss }: RestTimerProps) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const [finished, setFinished] = useState(false);
  const swRef = useRef<ServiceWorker | null>(null);

  // Register service worker + request notification permission on mount
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        swRef.current = reg.active;
        // Schedule the notification via SW so it fires even if screen locks
        reg.active?.postMessage({
          type: 'SCHEDULE_NOTIFICATION',
          delayMs: totalSeconds * 1000,
          title: 'Rest complete! 💪',
          body: `Time for your next set of ${exerciseName}`,
        });
      });
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    return () => {
      // Cancel scheduled notification if dismissed early
      navigator.serviceWorker?.ready.then((reg) => {
        reg.active?.postMessage({ type: 'CANCEL_NOTIFICATION' });
      });
    };
  }, [totalSeconds, exerciseName]);

  // Countdown
  useEffect(() => {
    if (remaining <= 0) {
      setFinished(true);
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 200]);
      const autoClose = setTimeout(onDismiss, 4000);
      return () => clearTimeout(autoClose);
    }
    const tick = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(tick);
  }, [remaining, onDismiss]);

  const pct = Math.min(100, ((totalSeconds - remaining) / totalSeconds) * 100);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}`;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-50 px-4 pointer-events-none">
      <div className="max-w-lg mx-auto pointer-events-auto">
        <div
          className={`rounded-2xl border shadow-2xl overflow-hidden transition-colors duration-500 ${
            finished ? 'bg-green-950 border-green-700' : 'bg-gray-900 border-gray-700'
          }`}
        >
          {/* Progress bar */}
          <div className="h-1 bg-gray-800">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${
                finished ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3 gap-4">
            {finished ? (
              <div>
                <p className="text-green-400 font-bold">Rest complete! 💪</p>
                <p className="text-green-600 text-xs mt-0.5">Next set of {exerciseName}</p>
              </div>
            ) : (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Resting · {exerciseName}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-white font-mono font-bold text-3xl tabular-nums leading-none">
                    {timeStr}
                  </span>
                  <span className="text-gray-600 text-sm">
                    / {totalSeconds}s
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={onDismiss}
              className="text-gray-500 hover:text-white text-sm transition-colors px-3 py-2 rounded-xl hover:bg-gray-800 flex-shrink-0"
            >
              {finished ? 'Done' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
