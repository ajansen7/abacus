'use client';

import { useState } from 'react';
import type { Workout, FullActivityEntry } from '@/lib/abacus';
import { webhookPost } from '@/lib/abacus';
import { EffortSlider } from './EffortSlider';

const KIND_COLOR: Record<string, string> = {
  easy: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  long: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  tempo: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  intervals: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  rest: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  cross: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  strength: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
};

const DEVIATION_COLOR: Record<string, string> = {
  met: 'text-emerald-400',
  partial: 'text-amber-400',
  swapped: 'text-sky-400',
  skipped: 'text-rose-400',
  extra: 'text-purple-400',
};

function dayLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

interface Props {
  workout: Workout;
  isToday: boolean;
  onEffortLogged: () => void;
  /** All activities for looking up matched activity details. */
  activities?: FullActivityEntry[];
}

export function WorkoutTile({ workout, isToday, onEffortLogged, activities }: Props) {
  const [open, setOpen] = useState(isToday);
  const [addingManual, setAddingManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const kind = workout.kind ?? 'easy';
  const chip = KIND_COLOR[kind] ?? KIND_COLOR.easy;
  const actual = workout.actual;

  async function onManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const distanceRaw = f.get('distanceMi');
    const notesRaw = f.get('notes') as string;
    await webhookPost('manual-activity', {
      op: 'add',
      activity: {
        date: workout.date ?? new Date().toISOString().slice(0, 10),
        type: String(f.get('type')),
        durationMin: Number(f.get('durationMin')),
        ...(distanceRaw ? { distanceM: Math.round(Number(distanceRaw) * 1609.34) } : {}),
        ...(notesRaw ? { notes: notesRaw } : {}),
      },
    });
    setSubmitting(false);
    setAddingManual(false);
    onEffortLogged();
  }

  async function onRemoveActual() {
    if (!actual?.activityId) return;
    if (!confirm('Remove this activity?')) return;
    await webhookPost('manual-activity', { op: 'delete', activityIssueId: actual.activityId });
    onEffortLogged();
  }

  return (
    <div
      className={`rounded-xl border border-border bg-panel p-4 transition ${
        isToday ? 'ring-1 ring-emerald-400/40' : ''
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted">{dayLabel(workout.date)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${chip}`}>
              {kind}
            </span>
            <span className="text-zinc-300">
              {workout.targetDurationMin ?? 0} min
              {workout.targetPace ? ` @ ${workout.targetPace}/mi` : ''}
            </span>
          </div>
        </div>
        {kind !== 'rest' && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-zinc-100"
          >
            {open ? 'close' : 'log'}
          </button>
        )}
      </div>

      {workout.notes ? <div className="mt-2 text-xs text-muted">{workout.notes}</div> : null}

      {/* Actual section — inline, always visible when present */}
      {actual ? (() => {
        // Look up the full activity for rich display
        const matchedActivity = actual.activityId && activities
          ? activities.find((a) => a.id === actual.activityId)
          : undefined;
        const distMi = matchedActivity?.distance
          ? (matchedActivity.distance / 1609.34).toFixed(1)
          : null;
        const paceMinMi = matchedActivity?.distance && matchedActivity?.movingTime && matchedActivity.distance > 0
          ? (() => {
              const mi = matchedActivity.distance! / 1609.34;
              const min = matchedActivity.movingTime! / 60;
              const minutes = Math.floor(min / mi);
              const seconds = Math.round(((min / mi) - minutes) * 60);
              return `${minutes}:${seconds.toString().padStart(2, '0')}`;
            })()
          : null;

        return (
          <div className="mt-3 border-t border-border pt-3">
            {/* Activity name + key stats */}
            {matchedActivity ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {matchedActivity.name || matchedActivity.sportType || 'Activity'}
                  </span>
                  {actual.activityId ? (
                    <button
                      type="button"
                      onClick={onRemoveActual}
                      className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                    >
                      remove
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`inline-block rounded border px-1.5 py-0.5 ${KIND_COLOR[actual.activityKind] ?? 'text-zinc-300 border-zinc-600'}`}>
                    {actual.activityKind}
                  </span>
                  <span className={`font-medium ${DEVIATION_COLOR[actual.deviationStatus] ?? 'text-zinc-400'}`}>
                    {actual.deviationStatus}
                  </span>
                  {actual.durationMin ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                      <span>{actual.durationMin} min</span>
                      {distMi && <span>{distMi} mi</span>}
                      {paceMinMi && <span>{paceMinMi} /mi</span>}
                      <span className="text-zinc-500 capitalize">{actual.activityKind}</span>
                    </div>
                  ) : null}
                  {actual.source === 'manual' ? (
                    <span className="text-zinc-600">manual</span>
                  ) : null}
                </div>
              </div>
            ) : (
              /* Fallback: no activity lookup available */
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-zinc-500">actual:</span>
                  <span className={`font-medium ${KIND_COLOR[actual.activityKind] ? `inline-block rounded border px-1.5 py-0.5 ${KIND_COLOR[actual.activityKind]}` : 'text-zinc-300'}`}>
                    {actual.activityKind}
                  </span>
                  {actual.durationMin ? (
                    <span className="text-zinc-400">{actual.durationMin} min</span>
                  ) : null}
                  <span className={`font-medium ${DEVIATION_COLOR[actual.deviationStatus] ?? 'text-zinc-400'}`}>
                    {actual.deviationStatus}
                  </span>
                  {actual.source === 'manual' ? (
                    <span className="text-zinc-600">· manual</span>
                  ) : null}
                </div>
                {actual.activityId ? (
                  <button
                    type="button"
                    onClick={onRemoveActual}
                    className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                  >
                    remove
                  </button>
                ) : null}
              </div>
            )}
            {actual.notes ? <div className="mt-1 text-xs text-zinc-600">{actual.notes}</div> : null}
          </div>
        );
      })() : workout.completed ? (
        <div className="mt-2 text-xs text-emerald-400">completed</div>
      ) : null}

      {/* Expandable panel: effort log + manual activity add */}
      {open && kind !== 'rest' ? (
        <div className="mt-3 border-t border-border pt-3 flex flex-col gap-3">
          {!actual && (
            <EffortSlider workoutId={workout.id} onLogged={onEffortLogged} />
          )}
          {!actual && !addingManual ? (
            <button
              type="button"
              onClick={() => setAddingManual(true)}
              className="self-start text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
            >
              + add activity manually
            </button>
          ) : null}
          {addingManual ? (
            <form onSubmit={onManualSubmit} className="flex flex-col gap-2">
              <div className="text-xs text-zinc-500">Log what you actually did</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Type
                  <input
                    name="type"
                    required
                    defaultValue={kind === 'strength' ? 'WeightTraining' : kind === 'easy' || kind === 'long' || kind === 'tempo' || kind === 'intervals' ? 'Run' : ''}
                    placeholder="Run, Ride…"
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
                    defaultValue={workout.targetDurationMin ?? ''}
                    className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Distance (mi, optional)
                  <input
                    name="distanceMi"
                    type="number"
                    step="0.01"
                    min={0}

                    className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
                    placeholder="miles"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Notes
                  <input
                    name="notes"
                    className="rounded border border-border bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingManual(false)}
                  className="text-xs text-zinc-600 hover:text-zinc-400"
                >
                  cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
