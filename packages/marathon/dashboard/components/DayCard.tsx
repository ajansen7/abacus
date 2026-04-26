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
  date: string;
  workout?: Workout;
  activities: FullActivityEntry[];
  isToday: boolean;
  onEffortLogged: () => void;
}

export function DayCard({ date, workout, activities, isToday, onEffortLogged }: Props) {
  const [open, setOpen] = useState(isToday);

  const kind = workout?.kind;
  const chip = kind ? (KIND_COLOR[kind] ?? KIND_COLOR.easy) : 'bg-zinc-800 text-zinc-400 border-zinc-700';

  async function onRemoveActual(activityId: string) {
    if (!confirm('Remove this activity?')) return;
    await webhookPost('manual-activity', { op: 'delete', activityIssueId: activityId });
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
          <div className="text-xs uppercase tracking-wide text-muted">{dayLabel(date)}</div>
          {workout && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${chip}`}>
                {kind}
              </span>
              <span className="text-zinc-300">
                {workout.targetDurationMin ?? 0} min
                {workout.targetPace ? ` @ ${workout.targetPace}/mi` : ''}
              </span>
            </div>
          )}
          {!workout && activities.length === 0 && (
            <div className="mt-1 text-xs text-zinc-500">No workout</div>
          )}
        </div>
        {workout && kind !== 'rest' && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-zinc-100"
          >
            {open ? 'close' : 'log'}
          </button>
        )}
      </div>

      {workout?.notes && <div className="mt-2 text-xs text-muted">{workout.notes}</div>}

      {/* Actual section */}
      {activities.length > 0 && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          {activities.map((act) => {
            const distMi = act.distance ? (act.distance / 1609.34).toFixed(1) : null;
            const paceMinMi = act.distance && act.movingTime && act.distance > 0
              ? (() => {
                  const mi = act.distance! / 1609.34;
                  const min = act.movingTime! / 60;
                  const minutes = Math.floor(min / mi);
                  const seconds = Math.round(((min / mi) - minutes) * 60);
                  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                })()
              : null;
            const elevFt = act.totalElevationGain ? Math.round(act.totalElevationGain * 3.28084) : null;
            
            // Check if this activity is the one matched to the workout
            const isMatched = workout?.actual?.activityId === act.id;
            const status = isMatched ? workout.actual!.deviationStatus : 'extra';

            return (
              <div key={act.id} className="flex flex-col gap-1 rounded bg-zinc-800/50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {act.name || act.sportType || 'Activity'}
                  </span>
                  {act.id && (
                    <button
                      type="button"
                      onClick={() => onRemoveActual(act.id)}
                      className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                    >
                      remove
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`inline-block rounded border px-1.5 py-0.5 ${KIND_COLOR[act.sportType?.toLowerCase() ?? ''] ?? 'text-zinc-300 border-zinc-600'}`}>
                    {act.sportType}
                  </span>
                  <span className={`font-medium ${DEVIATION_COLOR[status] ?? 'text-zinc-400'}`}>
                    {status}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                    {act.movingTime && <span>{Math.round(act.movingTime / 60)} min</span>}
                    {distMi && <span>{distMi} mi</span>}
                    {paceMinMi && <span>{paceMinMi} /mi</span>}
                    {elevFt !== null && elevFt > 0 && <span className="text-emerald-400">{elevFt} ft ↑</span>}
                    {act.averageHeartrate && <span className="text-rose-400">♥ {Math.round(act.averageHeartrate)} bpm</span>}
                    {act.sufferScore && <span className="text-amber-400">🔥 {act.sufferScore}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {workout && !workout.actual && workout.completed && (
         <div className="mt-2 text-xs text-emerald-400">completed</div>
      )}

      {/* Expandable panel: effort log */}
      {open && workout && kind !== 'rest' && (
        <div className="mt-3 border-t border-border pt-3 flex flex-col gap-3">
          {!workout.actual && (
            <EffortSlider workoutId={workout.id} onLogged={onEffortLogged} />
          )}
        </div>
      )}
    </div>
  );
}
