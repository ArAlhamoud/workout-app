'use client';

// Argue with the coach. A plain chat over his entire history — the same
// token that guards health sync guards this (it costs real model tokens).

import { useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'health-sync-token';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export default function CoachPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    // ?q= preseeds the input (e.g. the work-gym "plan my first Alrajhi
    // session" chip). window.location, not useSearchParams — no Suspense
    // boundary needed for one optional read at mount.
    try {
      const q = new URLSearchParams(window.location.search).get('q');
      if (q) setDraft(q.slice(0, 500));
    } catch { /* no preseed */ }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  const send = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setError('');
    setDraft('');
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setBusy(true);
    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ turns: next }),
      });
      if (res.status === 401) {
        setError('Connect Apple Health first — the coach uses the same sync token.');
        return;
      }
      const data = await res.json();
      if (data?.reply) {
        setTurns((cur) => [...cur, { role: 'assistant', content: data.reply }]);
      } else {
        setError('The coach is unreachable right now. Your plan on Home still stands.');
      }
    } catch {
      setError('No connection. The coach needs the network — your plan on Home does not.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] flex-col space-y-4">
      <div className="pt-1">
        <p className="section-label text-acc-teal/80">Your coach · knows the whole story</p>
        <h1 className="mt-0.5 bg-gradient-to-r from-white via-[#c7d2fe] to-[#99f6e4] bg-clip-text font-round text-2xl font-bold tracking-tight text-transparent">
          Ask the Coach
        </h1>
      </div>

      <div className="flex-1 space-y-3">
        {turns.length === 0 && (
          <div className="card px-4 py-3">
            <p className="text-app-tx2 text-sm leading-relaxed">
              Ask anything about your training — &ldquo;why is my chest press stuck?&rdquo;,
              &ldquo;I only have 20 minutes today&rdquo;, &ldquo;my shoulder felt odd on the last
              set&rdquo;. The coach reads your entire history, sleep and heart-rate data before
              answering — and you can push back.
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-card-lg border px-4 py-3 text-sm leading-relaxed ${
              t.role === 'user'
                ? 'ml-auto border-acc-teal/30 bg-acc-teal/10 text-app-tx1'
                : 'border-app-border bg-white/[0.04] text-app-tx1'
            }`}
          >
            {t.content}
          </div>
        ))}
        {busy && (
          <div className="max-w-[85%] rounded-card-lg border border-app-border bg-white/[0.04] px-4 py-3">
            <span className="text-app-tx3 text-sm">thinking…</span>
          </div>
        )}
        {error && <p className="text-rpe-hard text-xs">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-20 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Ask your coach…"
          className="w-full rounded-card border border-app-border bg-app-surface2 px-4 py-3 text-sm text-app-tx1 placeholder-app-tx3 transition-colors focus:border-acc-teal/60 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          className="flex-shrink-0 rounded-card bg-gradient-to-r from-acc-teal to-acc-teal-deep px-4 py-3 text-sm font-bold text-[#062521] shadow-glow-teal transition-all hover:brightness-105 disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none"
        >
          Send
        </button>
      </div>
    </div>
  );
}
