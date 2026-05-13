'use client';

import { useEffect, useState, useRef } from 'react';

interface RestTimerProps {
  totalSeconds: number;
  exerciseName: string;
  onDismiss: () => void;
}

async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

async function scheduleSwNotification(delayMs: number, title: string, body: string) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'SCHEDULE_NOTIFICATION', delayMs, title, body });
  } catch {
    // SW not available — silent fail, page countdown still works
  }
}

async function cancelSwNotification() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'CANCEL_NOTIFICATION' });
  } catch { /* silent */ }
}

function showDirectNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/icon-192.png',
      tag: 'rest-timer',
      renotify: true,
      silent: false,
    });
  } catch { /* iOS Safari throws — ignore */ }
}

export default function RestTimer({ totalSeconds, exerciseName, onDismiss }: RestTimerProps) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const [finished, setFinished] = useState(false);
  const permissionGranted = useRef(false);

  // Step 1: request permission, THEN schedule SW notification
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      permissionGranted.current = await requestNotificationPermission();

      if (cancelled) return;

      if (permissionGranted.current) {
        await scheduleSwNotification(
          totalSeconds * 1000,
          'Rest complete! 💪',
          `Time for your next set of ${exerciseName}`,
        );
      }
    }

    setup();

    return () => {
      cancelled = true;
      cancelSwNotification();
    };
  }, [totalSeconds, exerciseName]);

  // Step 2: countdown + direct notification when done
  useEffect(() => {
    if (remaining <= 0) {
      setFinished(true);
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 200]);

      // Direct notification — most reliable when page is backgrounded
      showDirectNotification(
        'Rest complete! 💪',
        `Time for your next set of ${exerciseName}`,
      );

      const autoClose = setTimeout(onDismiss, 4000);
      return () => clearTimeout(autoClose);
    }
    const tick = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(tick);
  }, [remaining, onDismiss, exerciseName]);

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
          <div className="h-1.5 bg-gray-800">
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
                <p className="text-green-400 font-bold text-base">Rest complete! 💪</p>
                <p className="text-green-600 text-xs mt-0.5">Next set of {exerciseName}</p>
              </div>
            ) : (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Resting · {exerciseName}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-white font-mono font-bold text-3xl tabular-nums leading-none">
                    {timeStr}
                  </span>
                  <span className="text-gray-600 text-sm">/ {totalSeconds}s</span>
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
