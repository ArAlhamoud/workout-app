'use client';

import { useEffect, useRef, useState } from 'react';

interface RestTimerProps {
  totalSeconds: number;
  exerciseName: string;
  onDismiss: () => void;
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
    new Notification(title, { body, icon: '/icon-192.png', tag: 'rest-timer' });
  } catch { /* iOS Safari throws — ignore */ }
}

function remainingSeconds(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

// Ask for notification permission only while it is still undecided.
function requestPermissionIfNeeded(onGranted: () => void) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  Notification.requestPermission().then((result) => {
    if (result === 'granted') onGranted();
  });
}

export default function RestTimer({ totalSeconds, exerciseName, onDismiss }: RestTimerProps) {
  // Timestamp-based countdown: remaining is always recomputed from Date.now(),
  // so the timer stays correct through iOS suspend/resume.
  const [endsAt, setEndsAt] = useState(() => Date.now() + totalSeconds * 1000);
  const [remaining, setRemaining] = useState(totalSeconds);
  const [canNotify, setCanNotify] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );
  const firedRef = useRef(false);

  // Permission is requested only from user gestures: the timer mounts as a
  // direct result of the tap that completes a set (so this effect runs inside
  // that gesture's activation window), and the adjust buttons re-request while
  // permission is still 'default'.
  useEffect(() => {
    requestPermissionIfNeeded(() => setCanNotify(true));
  }, []);

  // One interval per timer instance, keyed on endsAt only.
  useEffect(() => {
    setRemaining(remainingSeconds(endsAt));
    const tick = setInterval(() => setRemaining(remainingSeconds(endsAt)), 500);
    const onVisible = () => setRemaining(remainingSeconds(endsAt));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endsAt]);

  // Background notification via SW, rescheduled whenever the deadline moves.
  useEffect(() => {
    if (!canNotify) return;
    const delayMs = endsAt - Date.now();
    if (delayMs <= 0) return;
    scheduleSwNotification(delayMs, 'Rest complete! 💪', `Time for your next set of ${exerciseName}`);
    return () => {
      cancelSwNotification();
    };
  }, [endsAt, canNotify, exerciseName]);

  // Completion: vibrate + direct notification once, then auto-close.
  const finished = remaining <= 0;
  useEffect(() => {
    if (!finished || firedRef.current) return;
    firedRef.current = true;
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 200]);
    showDirectNotification('Rest complete! 💪', `Time for your next set of ${exerciseName}`);
  }, [finished, exerciseName]);

  useEffect(() => {
    if (!finished) return;
    const autoClose = setTimeout(onDismiss, 4000);
    return () => clearTimeout(autoClose);
  }, [finished, onDismiss]);

  function adjust(deltaSeconds: number) {
    requestPermissionIfNeeded(() => setCanNotify(true));
    setEndsAt((e) => Math.max(Date.now(), e + deltaSeconds * 1000));
  }

  const pct = Math.min(100, Math.max(0, ((totalSeconds - remaining) / totalSeconds) * 100));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}`;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-50 px-4 pointer-events-none">
      <div className="max-w-lg mx-auto pointer-events-auto">
        <div
          className={`rounded-card-lg border shadow-card overflow-hidden transition-colors duration-500 ${
            finished ? 'bg-green-950 border-green-700' : 'bg-app-surface border-app-border'
          }`}
        >
          <div className="h-1.5 bg-app-surface2">
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
                <p className="text-app-tx2 text-xs mb-0.5">Resting · {exerciseName}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-app-tx1 font-mono font-bold text-3xl tabular-nums leading-none">
                    {timeStr}
                  </span>
                  <span className="text-app-tx3 text-sm">/ {totalSeconds}s</span>
                </div>
              </div>
            )}
            <button
              onClick={onDismiss}
              className="text-app-tx2 hover:text-app-tx1 text-sm transition-colors px-3 py-2 rounded-card hover:bg-app-surface2 flex-shrink-0"
            >
              {finished ? 'Done' : 'Skip'}
            </button>
          </div>
          {!finished && (
            <div className="px-4 pb-3 flex items-center gap-2">
              <button
                onClick={() => adjust(-15)}
                className="text-xs bg-app-surface2 text-app-tx2 hover:text-app-tx1 px-2.5 py-1 rounded-full border border-app-border hover:border-white/15 transition-colors"
              >
                −15s
              </button>
              <button
                onClick={() => adjust(15)}
                className="text-xs bg-app-surface2 text-app-tx2 hover:text-app-tx1 px-2.5 py-1 rounded-full border border-app-border hover:border-white/15 transition-colors"
              >
                +15s
              </button>
              <button
                onClick={() => adjust(30)}
                className="text-xs bg-app-surface2 text-app-tx2 hover:text-app-tx1 px-2.5 py-1 rounded-full border border-app-border hover:border-white/15 transition-colors"
              >
                +30s
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
