'use client';
import { useEffect, useState } from 'react';
import { getState, webhookPost } from '@/lib/abacus';

export default function PlanContextPage() {
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getState()
      .then((s) => {
        setNotes(s.planContext?.notes ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function onSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await webhookPost('update-plan-context', { notes });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-2 text-lg font-semibold text-zinc-100">Steering context</h1>
      <p className="mb-4 text-sm text-muted">Free-form notes the agent reads on every adjustment. Edit anytime.</p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={12}
        className="w-full rounded-md border border-border bg-panel px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400/50"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved ? <span className="text-sm text-emerald-400">Saved</span> : null}
        {error ? <span className="text-sm text-rose-400">{error}</span> : null}
      </div>
    </main>
  );
}
