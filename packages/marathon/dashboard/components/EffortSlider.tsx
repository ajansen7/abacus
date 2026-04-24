'use client';

import { useState } from 'react';
import { invoke } from '@/lib/abacus';

interface Props {
  workoutId: string;
  onLogged: () => void;
}

export function EffortSlider({ workoutId, onLogged }: Props) {
  const [score, setScore] = useState(5);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await invoke('log_effort', { workoutId, score, notes: notes || undefined });
      setNotes('');
      onLogged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between text-xs text-muted">
        <span>RPE</span>
        <span className="font-mono text-sm text-zinc-200">{score}</span>
      </label>
      <input
        aria-label="perceived effort"
        type="range"
        min={1}
        max={10}
        step={1}
        value={score}
        onChange={(e) => setScore(Number(e.target.value))}
        className="w-full accent-emerald-400"
      />
      <input
        aria-label="effort notes"
        type="text"
        placeholder="notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-zinc-200 placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
      />
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? 'logging…' : 'log effort'}
      </button>
      {error ? <div className="text-xs text-rose-400">{error}</div> : null}
    </div>
  );
}
