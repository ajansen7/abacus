'use client';

import { useEffect, useRef, useState } from 'react';
import { WorkoutTile } from './WorkoutTile';
import type { WeekBlock, FullActivityEntry } from '@/lib/abacus';

/* ── Color mapping — matches WorkoutTile KIND_COLOR palette ── */
const DOT_COLOR: Record<string, string> = {
  easy: 'bg-emerald-400',
  long: 'bg-indigo-400',
  tempo: 'bg-amber-400',
  intervals: 'bg-rose-400',
  rest: 'bg-zinc-600',
  cross: 'bg-sky-400',
  strength: 'bg-purple-400',
};

const DOT_COLOR_DIM: Record<string, string> = {
  easy: 'bg-emerald-400/30',
  long: 'bg-indigo-400/30',
  tempo: 'bg-amber-400/30',
  intervals: 'bg-rose-400/30',
  rest: 'bg-zinc-700/40',
  cross: 'bg-sky-400/30',
  strength: 'bg-purple-400/30',
};

function weekEndDate(startDate: string): string {
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + 6);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function weekStartLabel(startDate: string): string {
  return new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function isWeekPast(week: WeekBlock, todayIso: string): boolean {
  const endDate = new Date(`${week.startDate}T00:00:00`);
  endDate.setDate(endDate.getDate() + 6);
  return endDate.toISOString().slice(0, 10) < todayIso;
}

function weekCompletionRatio(week: WeekBlock): number {
  const actionable = week.workouts.filter((w) => (w.kind ?? 'easy') !== 'rest');
  if (actionable.length === 0) return 1;
  const done = actionable.filter((w) => w.actual || w.completed).length;
  return done / actionable.length;
}

interface Props {
  weeks: WeekBlock[];
  currentWeekIndex: number | null;
  todayIso: string;
  onEffortLogged: () => void;
  /** All activities for passing down to WorkoutTile for rich display. */
  activities?: FullActivityEntry[];
}

export function PlanOverview({ weeks, currentWeekIndex, todayIso, onEffortLogged, activities }: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showOverview, setShowOverview] = useState(true);
  const currentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the current week on first mount
  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  if (weeks.length === 0) return null;

  // Group weeks into phases for visual separation
  const totalWeeks = weeks.length;

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setShowOverview((v) => !v)}
        className="mb-3 flex w-full items-center justify-between text-xs uppercase tracking-widest text-muted hover:text-zinc-300"
      >
        <span>Plan overview · {totalWeeks} weeks</span>
        <span className="text-base">{showOverview ? '▲' : '▼'}</span>
      </button>

      {showOverview && (
        <div className="flex flex-col gap-0.5">
          {weeks.map((week) => {
            const isCurrent = week.index === currentWeekIndex;
            const isPast = isWeekPast(week, todayIso);
            const isExpanded = expandedIndex === week.index;
            const completionRatio = weekCompletionRatio(week);
            const allDone = isPast && completionRatio === 1;
            const dotMap = isPast ? DOT_COLOR_DIM : DOT_COLOR;

            return (
              <div
                key={week.id}
                ref={isCurrent ? currentRef : undefined}
                className={`
                  rounded-lg border transition-all duration-200
                  ${isCurrent
                    ? 'border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-400/20'
                    : 'border-border bg-panel/50 hover:bg-panel'}
                  ${isPast && !isExpanded ? 'opacity-60' : ''}
                `}
              >
                {/* Compact row */}
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : week.index)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left"
                >
                  {/* Week number */}
                  <span
                    className={`w-8 shrink-0 text-xs font-medium tabular-nums ${
                      isCurrent ? 'text-emerald-400' : isPast ? 'text-zinc-600' : 'text-zinc-400'
                    }`}
                  >
                    W{week.index + 1}
                  </span>

                  {/* Theme */}
                  <span
                    className={`w-20 shrink-0 truncate text-xs ${
                      isCurrent ? 'text-emerald-300' : isPast ? 'text-zinc-600' : 'text-zinc-400'
                    }`}
                    title={week.theme}
                  >
                    {week.theme || '—'}
                  </span>

                  {/* Date range */}
                  <span
                    className={`hidden w-28 shrink-0 text-xs sm:inline ${
                      isPast ? 'text-zinc-700' : 'text-zinc-600'
                    }`}
                  >
                    {weekStartLabel(week.startDate)} – {weekEndDate(week.startDate)}
                  </span>

                  {/* Workout dots */}
                  <span className="flex items-center gap-1">
                    {week.workouts.map((wo) => {
                      const kind = wo.kind ?? 'easy';
                      const hasActual = !!wo.actual || !!wo.completed;
                      const dotColor = dotMap[kind] ?? dotMap.easy;
                      return (
                        <span
                          key={wo.id}
                          className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor} ${
                            hasActual ? 'ring-1 ring-white/20' : ''
                          }`}
                          title={`${kind}${wo.date ? ` · ${wo.date}` : ''}${hasActual ? ' ✓' : ''}`}
                        />
                      );
                    })}
                  </span>

                  {/* Completion indicator for past weeks */}
                  {isPast && (
                    <span className="ml-auto shrink-0 text-xs">
                      {allDone ? (
                        <span className="text-emerald-500/60">✓</span>
                      ) : (
                        <span className="text-zinc-600">
                          {Math.round(completionRatio * 100)}%
                        </span>
                      )}
                    </span>
                  )}

                  {/* Current badge */}
                  {isCurrent && (
                    <span className="ml-auto shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      now
                    </span>
                  )}

                  {/* Expand indicator */}
                  <span className={`shrink-0 text-xs text-zinc-600 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                </button>

                {/* Expanded workout detail */}
                {isExpanded && (
                  <div className="border-t border-border px-3 pb-3 pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {week.workouts.map((w) => (
                        <WorkoutTile
                          key={w.id}
                          workout={w}
                          isToday={w.date === todayIso}
                          onEffortLogged={onEffortLogged}
                          activities={activities}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
