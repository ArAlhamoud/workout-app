'use client';

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/native-health';
import {
  cancelRestNotification,
  hapticSuccess,
  scheduleRestNotification,
} from '@/lib/native-feedback';

interface RestTimerProps {
  totalSeconds: number;
  exerciseName: string;
  onDismiss: () => void;
}

/** Last N seconds get the unmissable treatment. */
const IMMINENT_SECONDS = 5;

/**
 * If the webview was suspended the alert timeout fires whenever iOS gets around
 * to it, which can be minutes late. A beep that far past the deadline is noise,
 * not information, so anything staler than this is dropped.
 */
const STALE_ALERT_MS = 5_000;

// ── Audio ────────────────────────────────────────────────────────────────────
// WKWebView has no Web Notifications and iOS has never supported
// navigator.vibrate, so WebAudio is the only cue we can actually make in the
// native shell. It is gated by the autoplay policy: the AudioContext has to be
// created/resumed inside a user gesture, after which it may be played from a
// timer. primeRestAlertAudio() is therefore called on the tap that starts the
// timer (mount) and on every adjust tap.

type AudioCtor = typeof AudioContext;
type WindowWithWebkitAudio = Window & { webkitAudioContext?: AudioCtor };

let audioCtx: AudioContext | null = null;

/** Create/resume the shared AudioContext. Must be called from a user gesture. */
function primeRestAlertAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!audioCtx) {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!Ctor) return; // No WebAudio at all — the timer stays silent but works.
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {});
  } catch {
    audioCtx = null; // Never let an audio problem break the countdown.
  }
}

/** Three short blips, rising on the last one. No-op if audio was never primed. */
function playRestBeep(): void {
  const ctx = audioCtx;
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const start = ctx.currentTime + 0.02;
    [0, 0.22, 0.44].forEach((offset, i) => {
      const at = start + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 2 ? 1245 : 880, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.45, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });
  } catch {
    // Audio is a nicety; the visual finish state is the source of truth.
  }
}

// ── NATIVE SEAM ──────────────────────────────────────────────────────────────
// scheduleRestAlert / cancelRestAlert are THE only place rest alerts are raised.
//
// Two layers, because they cover different situations:
//   - WebAudio beep + haptic: immediate, but only while the app is foregrounded.
//   - A scheduled local notification: survives backgrounding and a locked
//     screen, which is where a phone actually is between sets.
// Both are armed together; the notification is cancelled whenever the deadline
// moves. Outside the native shell the notification calls no-op and the beep is
// the whole story, exactly as before.

let alertTimeout: ReturnType<typeof setTimeout> | null = null;

/** Arrange for the rest-over alert to fire `seconds` from now. */
function scheduleRestAlert(seconds: number, exerciseName?: string): void {
  cancelRestAlert();
  const delayMs = Math.max(0, seconds * 1000);
  const fireAt = Date.now() + delayMs;

  scheduleRestNotification(seconds, exerciseName);

  alertTimeout = setTimeout(() => {
    alertTimeout = null;
    // Woken late (suspended device): the notification already covered it.
    if (Date.now() - fireAt > STALE_ALERT_MS) return;
    playRestBeep();
    hapticSuccess();
  }, delayMs);
}

/** Drop a pending alert (deadline moved, timer skipped, component unmounted). */
function cancelRestAlert(): void {
  if (alertTimeout !== null) {
    clearTimeout(alertTimeout);
    alertTimeout = null;
  }
  cancelRestNotification();
}

function remainingSeconds(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

export default function RestTimer({ totalSeconds, exerciseName, onDismiss }: RestTimerProps) {
  // Timestamp-based countdown: remaining is always recomputed from Date.now(),
  // so the timer stays correct through iOS suspend/resume.
  const [endsAt, setEndsAt] = useState(() => Date.now() + totalSeconds * 1000);
  const [remaining, setRemaining] = useState(totalSeconds);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  // The timer mounts as a direct result of the tap that completes a set, so
  // this runs inside that gesture's activation window. The one-shot pointerdown
  // listener is a safety net for the case where it does not.
  useEffect(() => {
    primeRestAlertAudio();
    const onGesture = () => primeRestAlertAudio();
    document.addEventListener('pointerdown', onGesture, { once: true, capture: true });
    return () => document.removeEventListener('pointerdown', onGesture, { capture: true });
  }, []);

  // One interval per timer instance, keyed on endsAt only.
  useEffect(() => {
    setRemaining(remainingSeconds(endsAt));
    const tick = setInterval(() => setRemaining(remainingSeconds(endsAt)), 250);
    const onVisible = () => setRemaining(remainingSeconds(endsAt));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endsAt]);

  // Re-armed whenever the deadline moves; cancelled on unmount so a dismissed
  // timer can never beep.
  useEffect(() => {
    scheduleRestAlert((endsAt - Date.now()) / 1000, exerciseName);
    return cancelRestAlert;
  }, [endsAt, exerciseName]);

  const finished = remaining <= 0;
  const imminent = !finished && remaining <= IMMINENT_SECONDS;

  useEffect(() => {
    if (!finished) return;
    const autoClose = setTimeout(onDismiss, 4000);
    return () => clearTimeout(autoClose);
  }, [finished, onDismiss]);

  function adjust(deltaSeconds: number) {
    primeRestAlertAudio(); // Real user gesture — cheapest place to unlock audio.
    setEndsAt((e) => Math.max(Date.now(), e + deltaSeconds * 1000));
  }

  const pct = Math.min(100, Math.max(0, ((totalSeconds - remaining) / totalSeconds) * 100));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}`;

  const shellClass = finished
    ? 'border-acc-teal/60 shadow-glow-teal'
    : imminent
      ? 'border-acc-teal/50 shadow-glow-teal'
      : 'border-app-border-hi shadow-nav';

  const barClass =
    finished || imminent
      ? 'bg-acc-teal shadow-[0_0_16px_rgba(45,212,191,0.95)]'
      : 'bg-gradient-to-r from-acc-teal via-acc-cyan to-[#818cf8] shadow-[0_0_12px_rgba(45,212,191,0.8)]';

  return (
    <div className="fixed bottom-16 left-0 right-0 z-50 px-4 pointer-events-none">
      <div className="max-w-lg mx-auto pointer-events-auto">
        {/* Glass capsule — floats above the nav, glows teal for the last 5s and the finish */}
        <div
          className={`glass-overlay rounded-card-lg border overflow-hidden transition-colors duration-500 ${shellClass}`}
        >
          <div className="h-1.5 bg-white/10">
            <div
              className={`h-full transition-all duration-300 ease-linear ${barClass}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3 gap-4">
            {finished ? (
              <div>
                <p className="glow-teal font-bold text-base">Rest complete! 💪</p>
                <p className="text-app-tx2 text-xs mt-0.5">Next set of {exerciseName}</p>
              </div>
            ) : (
              <div>
                <p className="text-app-tx2 text-xs mb-0.5">Resting · {exerciseName}</p>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`glow-teal font-round font-light tabular-nums leading-none transition-all duration-300 ${
                      imminent
                        ? 'text-6xl motion-safe:animate-pulse drop-shadow-[0_0_18px_rgba(45,212,191,0.85)]'
                        : 'text-4xl'
                    }`}
                  >
                    {timeStr}
                  </span>
                  {imminent ? (
                    <span className="chip bg-acc-teal/15 text-acc-teal">Get ready</span>
                  ) : (
                    <span className="text-app-tx3 text-sm">/ {totalSeconds}s</span>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={onDismiss}
              className="text-app-tx2 hover:text-app-tx1 text-sm transition-colors px-3 py-2 rounded-card hover:bg-white/5 flex-shrink-0"
            >
              {finished ? 'Done' : 'Skip'}
            </button>
          </div>
          {!finished && (
            <div className="px-4 pb-3 flex items-center gap-2">
              <button
                onClick={() => adjust(-15)}
                className="text-xs bg-white/[0.06] text-app-tx2 hover:text-app-tx1 px-2.5 py-1 rounded-full border border-app-border hover:border-app-border-hi transition-colors"
              >
                −15s
              </button>
              <button
                onClick={() => adjust(15)}
                className="text-xs bg-white/[0.06] text-app-tx2 hover:text-app-tx1 px-2.5 py-1 rounded-full border border-app-border hover:border-app-border-hi transition-colors"
              >
                +15s
              </button>
              <button
                onClick={() => adjust(30)}
                className="text-xs bg-white/[0.06] text-app-tx2 hover:text-app-tx1 px-2.5 py-1 rounded-full border border-app-border hover:border-app-border-hi transition-colors"
              >
                +30s
              </button>
            </div>
          )}
          {/* Native shell only: be honest that the alert needs the app open. */}
          {native && !finished && (
            <p className="px-4 pb-3 text-[11px] text-app-tx3">
              Alerts need this screen open · background alerts ship in the next app update
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
