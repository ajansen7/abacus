'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkoutTile } from './WorkoutTile';
import { TaskStream } from './TaskStream';
import { eventsUrl, getState, type MarathonState } from '@/lib/abacus';

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

export function Dashboard({ initial }: { initial: MarathonState | null }) {
  const [state, setState] = useState<MarathonState | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [connected, setConnected] = useState(false);
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
                  : { ...(existing ?? { taskId: evt.taskId }), phase: 'failed', reason: evt.reason };
          const filtered = prev.filter((t) => t.taskId !== evt.taskId);
          return [next, ...filtered].slice(0, 10);
        });
        if (evt.type === 'TASK_COMPLETE' || evt.type === 'TASK_FAILED') void refresh();
      } catch {
        // Non-JSON keepalive comment — ignore.
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

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Marathon</div>
          <h1 className="text-lg font-semibold text-zinc-100">
            {state.plan?.raceDate
              ? `Race ${state.plan.raceDate} @ ${state.plan.goalPace ?? '—'}/km`
              : 'No active plan'}
          </h1>
        </div>
        <div className="text-right text-xs">
          <div className={connected ? 'text-emerald-400' : 'text-muted'}>
            {connected ? '● live' : '○ offline'}
          </div>
          <div className="text-muted">{state.todayIso}</div>
        </div>
      </header>

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
      ) : null}

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

      {state.recentActivities.length > 0 ? (
        <section className="mb-6">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted">Recent activity</div>
          <div className="flex flex-col gap-2">
            {state.recentActivities.slice(0, 5).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2 text-sm"
              >
                <div className="truncate">
                  <span className="text-zinc-200">{a.name ?? '(unnamed)'}</span>
                  <span className="ml-2 text-xs text-muted">
                    {a.sportType ?? ''} {a.aspectType ? `· ${a.aspectType}` : ''}
                  </span>
                </div>
                <div className="text-right text-xs text-muted">
                  {a.distance ? `${(a.distance / 1000).toFixed(2)} km` : ''}
                  {a.startDateLocal ? ` · ${a.startDateLocal.slice(0, 16).replace('T', ' ')}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
