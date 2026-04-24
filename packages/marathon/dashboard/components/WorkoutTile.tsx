'use client';

import { useState } from 'react';
import type { Workout } from '@/lib/abacus';
import { EffortSlider } from './EffortSlider';

const KIND_COLOR: Record<string, string> = {
  easy: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  long: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  tempo: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  intervals: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  rest: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  cross: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
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
}

export function WorkoutTile({ workout, isToday, onEffortLogged }: Props) {
  const [open, setOpen] = useState(isToday);
  const kind = workout.kind ?? 'easy';
  const chip = KIND_COLOR[kind] ?? KIND_COLOR.easy;

  return (
    <div
      className={`rounded-xl border border-border bg-panel p-4 transition ${
        isToday ? 'ring-1 ring-emerald-400/40' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{dayLabel(workout.date)}</div>
          <div className="mt-1 text-sm">
            <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${chip}`}>
              {kind}
            </span>
            <span className="ml-2 text-zinc-300">
              {workout.targetDurationMin ?? 0} min
              {workout.targetPace ? ` @ ${workout.targetPace}/km` : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="log effort"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-zinc-100"
        >
          {open ? 'close' : 'log'}
        </button>
      </div>
      {workout.notes ? <div className="mt-2 text-xs text-muted">{workout.notes}</div> : null}
      {open && !workout.completed && kind !== 'rest' ? (
        <div className="mt-3 border-t border-border pt-3">
          <EffortSlider workoutId={workout.id} onLogged={onEffortLogged} />
        </div>
      ) : null}
      {workout.completed ? (
        <div className="mt-2 text-xs text-emerald-400">completed</div>
      ) : null}
    </div>
  );
}
