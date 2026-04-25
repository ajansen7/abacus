'use client';
import { useState } from 'react';
import { webhookPost } from '@/lib/abacus';

export function ManualActivityForm({ onAdded }: { onAdded: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const distanceRaw = f.get('distanceM');
    const notesRaw = f.get('notes') as string;
    const distanceM = distanceRaw ? Number(distanceRaw) : undefined;
    const notes = notesRaw || undefined;
    await webhookPost('manual_activity', {
      op: 'add',
      activity: {
        date: String(f.get('date')),
        type: String(f.get('type')),
        durationMin: Number(f.get('durationMin')),
        ...(distanceM !== undefined ? { distanceM } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
    });
    setSubmitting(false);
    (e.currentTarget as HTMLFormElement).reset();
    onAdded();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-panel p-3"
    >
      <div className="text-xs uppercase tracking-widest text-muted">Add manual activity</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Date
          <input
            type="date"
            name="date"
            required
            className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Type
          <input
            name="type"
            required
            placeholder="Run, Ride, WeightTraining…"
            className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Duration (min)
          <input
            name="durationMin"
            type="number"
            required
            min={1}
            className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Distance (m, optional)
          <input
            name="distanceM"
            type="number"
            min={0}
            className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Notes (optional)
        <input name="notes" className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {submitting ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}
