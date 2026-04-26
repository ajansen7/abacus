'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkoutTile } from './WorkoutTile';
import { TaskStream } from './TaskStream';
import { ActivityRow } from './ActivityRow';
import { eventsUrl, getState, type FullActivityEntry, type MarathonState } from '@/lib/abacus';

type LifecycleEvent =
  | { type: 'TASK_QUEUED'; taskId: string; kind: string }
  | { type: 'TASK_STARTED'; taskId: string; tmuxSession: string }
  | { type: 'TASK_COMPLETE'; taskId: string }
  | { type: 'TASK_FAILED'; taskId: string; reason: string }
  | { type: 'HEARTBEAT'; ts: string };

interface LiveTask {
  taskId: string;
  kind?: string;
  phase: 'queued' | 'started' | 'complete' | 'failed';
  reason?: string;
}

function daysUntil(isoDate: string | undefined): number | null {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.ceil((target - Date.now()) / 86_400_000);
}

function unmatchedActivities(
  activities: FullActivityEntry[],
  weeks: MarathonState['weeks'],
): FullActivityEntry[] {
  const matchedIds = new Set<string>();
  for (const week of weeks) {
    for (const w of week.workouts) {
      if (w.actual?.activityId) matchedIds.add(w.actual.activityId);
    }
  }
  return activities.filter((a) => !matchedIds.has(a.id));
}

export function Dashboard({ initial }: { initial: MarathonState | null }) {
  const [state, setState] = useState<MarathonState | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [connected, setConnected] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!initial) void refresh();
  }, [initial, refresh]);

  useEffect(() => {
    const es = new EventSource(eventsUrl());
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as LifecycleEvent;
        if (evt.type === 'HEARTBEAT') return;
        setTasks((prev) => {
          const existing = prev.find((t) => t.taskId === evt.taskId);
          const next: LiveTask =
            evt.type === 'TASK_QUEUED'
              ? { taskId: evt.taskId, kind: evt.kind, phase: 'queued' }
              : evt.type === 'TASK_STARTED'
                ? { ...(existing ?? { taskId: evt.taskId }), phase: 'started' }
                : evt.type === 'TASK_COMPLETE'
                  ? { ...(existing ?? { taskId: evt.taskId }), phase: 'complete' }
                  : {
                      ...(existing ?? { taskId: evt.taskId }),
                      phase: 'failed' as const,
                      reason: (evt as Extract<LifecycleEvent, { type: 'TASK_FAILED' }>).reason,
                    };
          const filtered = prev.filter((t) => t.taskId !== evt.taskId);
          return [next, ...filtered].slice(0, 10);
        });
        if (evt.type === 'TASK_COMPLETE' || evt.type === 'TASK_FAILED') void refresh();
      } catch {
        // Non-JSON keepalive — ignore.
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [refresh]);

  if (!state) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded-lg border border-border bg-panel p-4 text-sm text-muted">
          {loadError ? `Failed to load: ${loadError}` : 'Loading…'}
        </div>
      </main>
    );
  }

  const currentWeek =
    state.currentWeekIndex !== null
      ? state.weeks.find((w) => w.index === state.currentWeekIndex) ?? null
      : state.weeks[0] ?? null;

  const daysToRace = daysUntil(state.race?.date ?? state.plan?.raceDate);
  const activities = state.allActivities ?? state.recentActivities;
  const unmatched = unmatchedActivities(activities, state.weeks);

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Marathon</div>
          {state.race ? (
            <h1 className="text-lg font-semibold text-zinc-100">
              {state.race.name}
              {state.race.date ? (
                <span className="ml-2 text-sm font-normal text-muted">· {state.race.date}</span>
              ) : null}
            </h1>
          ) : state.plan ? (
            <h1 className="text-lg font-semibold text-zinc-100">
              {state.plan.raceDate
                ? `Race ${state.plan.raceDate} @ ${state.plan.goalPace ?? '—'}/km`
                : 'No active plan'}
            </h1>
          ) : (
            <h1 className="text-lg font-semibold text-zinc-100">No active plan</h1>
          )}
          {daysToRace !== null ? (
            <div className="mt-1 text-xs text-muted">{daysToRace} days to race</div>
          ) : null}
          {state.planContext?.notes ? (
            <div
              className="mt-1 max-w-sm truncate text-xs text-zinc-500"
              title={state.planContext.notes}
            >
              {state.planContext.notes.length > 120
                ? `${state.planContext.notes.slice(0, 120)}…`
                : state.planContext.notes}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <div className={connected ? 'text-emerald-400' : 'text-muted'}>
            {connected ? '● live' : '○ offline'}
          </div>
          <div className="text-muted">{state.todayIso}</div>
          <div className="mt-1 flex gap-2">
            <a href="/plan/new" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-100">
              new plan
            </a>
            <a href="/plan/context" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-100">
              context
            </a>
          </div>
        </div>
      </header>

      {/* Current week workouts — each tile shows planned + actual inline */}
      {currentWeek ? (
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>
              Week {currentWeek.index + 1} · {currentWeek.theme}
            </span>
            <span>start {currentWeek.startDate}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {currentWeek.workouts.map((w) => (
              <WorkoutTile
                key={w.id}
                workout={w}
                isToday={w.date === state.todayIso}
                onEffortLogged={() => void refresh()}
              />
            ))}
          </div>
        </section>
      ) : state.plan && state.weeks.length === 0 ? (
        <section className="mb-6">
          <div className="rounded-lg border border-border bg-panel p-4 text-sm text-muted">
            Plan is generating — check agent activity below.
          </div>
        </section>
      ) : null}

      {/* Agent activity */}
      {tasks.length > 0 ? (
        <section className="mb-6">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted">Agent activity</div>
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <div key={t.taskId} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-300">{t.taskId}</span>
                  <span
                    className={
                      t.phase === 'complete'
                        ? 'text-emerald-400'
                        : t.phase === 'failed'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }
                  >
                    {t.kind ? `${t.kind} · ` : ''}
                    {t.phase}
                    {t.reason ? ` (${t.reason})` : ''}
                  </span>
                </div>
                <TaskStream taskId={t.taskId} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Unmatched / extra activities (didn't map to a planned workout) */}
      {unmatched.length > 0 ? (
        <section className="mb-6">
          <button
            type="button"
            onClick={() => setShowUnmatched((v) => !v)}
            className="mb-2 flex items-center gap-1 text-xs uppercase tracking-widest text-muted hover:text-zinc-300"
          >
            <span>Unmatched activities ({unmatched.length})</span>
            <span>{showUnmatched ? '▲' : '▼'}</span>
          </button>
          {showUnmatched ? (
            <div className="flex flex-col gap-2">
              {unmatched.map((a) => (
                <ActivityRow key={a.id} activity={a} onChange={() => void refresh()} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Flags */}
      {state.flags.length > 0 ? (
        <section className="mb-6">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted">Flags</div>
          <div className="flex flex-col gap-2">
            {state.flags.map((f) => (
              <div
                key={f.id}
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              >
                <div className="text-xs uppercase">{f.severity ?? 'warn'}</div>
                <div>{f.reason ?? f.title}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
