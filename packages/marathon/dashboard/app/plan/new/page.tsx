'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@/lib/abacus';

export default function NewPlanPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const goalFinishTime = (f.get('goalFinishTime') as string) || undefined;
    const raceLocation = (f.get('raceLocation') as string) || undefined;
    const templateId = (f.get('templateId') as string) || undefined;
    const contextNotes = (f.get('contextNotes') as string) || '';
    try {
      await invoke('create_plan', {
        race: {
          name: String(f.get('raceName') ?? ''),
          date: String(f.get('raceDate') ?? ''),
          distance: String(f.get('raceDistance') ?? 'marathon'),
          ...(raceLocation !== undefined ? { location: raceLocation } : {}),
          ...(goalFinishTime !== undefined ? { goalFinishTime } : {}),
        },
        startDate: String(f.get('startDate') ?? ''),
        contextNotes,
        ...(templateId !== undefined ? { templateId } : {}),
      });
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-lg font-semibold text-zinc-100">New training plan</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Race name
          <input name="raceName" required className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Race date
          <input type="date" name="raceDate" required className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Distance
          <select name="raceDistance" defaultValue="marathon" className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50">
            <option value="5k">5 km</option>
            <option value="10k">10 km</option>
            <option value="half">Half marathon</option>
            <option value="marathon">Marathon</option>
            <option value="ultra">Ultra</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Location (optional)
          <input name="raceLocation" className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Goal finish time HH:MM:SS (optional)
          <input name="goalFinishTime" pattern="\d{1,2}:\d{2}:\d{2}" placeholder="4:30:00" className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Training start date
          <input type="date" name="startDate" required defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Steering context
          <textarea name="contextNotes" rows={5} placeholder="Nursing left knee. Training partner is total beginner — we're loosely following couch-to-marathon. Flexible on weekday timing." className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Template (optional — agent chooses if blank)
          <select name="templateId" defaultValue="" className="rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50">
            <option value="">Let the agent choose</option>
            <option value="couch-to-marathon">couch-to-marathon</option>
            <option value="base-builder">base-builder</option>
            <option value="competitive">competitive</option>
          </select>
        </label>
        <button type="submit" disabled={submitting} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create plan'}
        </button>
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      </form>
    </main>
  );
}
