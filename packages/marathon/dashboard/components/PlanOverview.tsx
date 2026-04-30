'use client';

import { useEffect, useRef, useState } from 'react';
import { DayCard } from './DayCard';
import { webhookPost, type WeekBlock, type Workout, type FullActivityEntry } from '@/lib/abacus';


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

/* Chip colors for compact cards — border + text only (no bg fill to keep it readable small) */
const MINI_CHIP: Record<string, string> = {
  easy: 'border-emerald-500/50 text-emerald-400',
  long: 'border-indigo-500/50 text-indigo-400',
  tempo: 'border-amber-500/50 text-amber-400',
  intervals: 'border-rose-500/50 text-rose-400',
  rest: 'border-zinc-700 text-zinc-600',
  cross: 'border-sky-500/50 text-sky-400',
  strength: 'border-purple-500/50 text-purple-400',
};

const DEVIATION_TEXT: Record<string, string> = {
  met: 'text-emerald-400',
  partial: 'text-amber-400',
  swapped: 'text-sky-400',
  skipped: 'text-rose-400',
  extra: 'text-purple-400',
};

const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

interface MiniCardProps {
  date: string;
  workout?: Workout;
  activities: FullActivityEntry[];
  isToday: boolean;
}

function MiniDayCard({ date, workout, activities, isToday }: MiniCardProps) {
  const d = new Date(`${date}T00:00:00`);
  const dayAbbr = DAY_ABBR[d.getDay()];
  const kind = workout?.kind;
  const chip = kind ? (MINI_CHIP[kind] ?? MINI_CHIP.easy) : 'border-zinc-800 text-zinc-600';
  const isRest = kind === 'rest';

  // Find matched activity by activityId (Beads issue ID)
  const matchedAct = workout?.actual?.activityId
    ? activities.find((a) => a.id === workout.actual!.activityId)
    : activities.find((a) => a.startDateLocal?.startsWith(date));

  const deviation = workout?.actual?.deviationStatus;
  const isCompleted = !!workout?.actual || !!workout?.completed;

  // Stats from matched activity
  const elevFt = matchedAct?.totalElevationGain
    ? Math.round(matchedAct.totalElevationGain * 3.28084)
    : null;
  const hr = matchedAct?.averageHeartrate
    ? Math.round(matchedAct.averageHeartrate)
    : null;
  const actualMin = workout?.actual?.durationMin
    ?? (matchedAct?.movingTime ? Math.round(matchedAct.movingTime / 60) : null);

  return (
    <div
      className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border px-0.5 py-1.5 text-center ${
        isToday
          ? 'border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-400/20'
          : 'border-border bg-zinc-900/60'
      }`}
    >
      {/* Day */}
      <span className={`text-[10px] font-medium leading-none ${isToday ? 'text-emerald-400' : 'text-zinc-500'}`}>
        {dayAbbr}
      </span>

      {/* Kind chip */}
      {kind ? (
        <span className={`rounded border px-1 text-[8px] font-medium uppercase leading-[14px] ${chip}`}>
          {isRest ? 'rest' : kind.slice(0, 3)}
        </span>
      ) : (
        <span className="text-[9px] text-zinc-700">—</span>
      )}

      {/* Target duration */}
      {workout?.targetDurationMin && !isRest ? (
        <span className="text-[10px] leading-none text-zinc-500">
          {workout.targetDurationMin}m
        </span>
      ) : null}

      {/* Actual: deviation status + duration */}
      {isCompleted && !isRest ? (
        <span className={`text-[10px] font-medium leading-none ${DEVIATION_TEXT[deviation ?? ''] ?? 'text-emerald-400'}`}>
          {deviation ? deviation.slice(0, 3) : '✓'}
        </span>
      ) : null}
      {actualMin && !isRest ? (
        <span className="text-[10px] leading-none text-zinc-500">{actualMin}m</span>
      ) : null}

      {/* Elevation */}
      {elevFt !== null && elevFt > 50 ? (
        <span className="text-[9px] leading-none text-emerald-500">↑{elevFt > 999 ? `${(elevFt / 1000).toFixed(1)}k` : elevFt}</span>
      ) : null}

      {/* HR */}
      {hr ? (
        <span className="text-[9px] leading-none text-rose-400">♥{hr}</span>
      ) : null}
    </div>
  );
}

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

type WeekViewMode = 'compact' | 'expanded';

interface Props {
  weeks: WeekBlock[];
  currentWeekIndex: number | null;
  todayIso: string;
  onEffortLogged: () => void;
  /** All activities for passing down to DayCard/MiniDayCard for rich display. */
  activities?: FullActivityEntry[];
}

export function PlanOverview({ weeks, currentWeekIndex, todayIso, onEffortLogged, activities }: Props) {
  const [viewMode, setViewMode] = useState<Record<number, WeekViewMode>>({});
  const [showOverview, setShowOverview] = useState(true);
  const currentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the current week on first mount
  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  if (weeks.length === 0) return null;

  function cycleView(weekIndex: number) {
    setViewMode((prev) => {
      const current = prev[weekIndex];
      if (!current) return { ...prev, [weekIndex]: 'compact' };
      if (current === 'compact') return { ...prev, [weekIndex]: 'expanded' };
      const next = { ...prev };
      delete next[weekIndex];
      return next;
    });
  }

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
            const mode = viewMode[week.index] as WeekViewMode | undefined;
            const completionRatio = weekCompletionRatio(week);
            const allDone = isPast && completionRatio === 1;
            const dotMap = isPast ? DOT_COLOR_DIM : DOT_COLOR;

            const expandIcon = !mode ? '›' : mode === 'compact' ? '⊞' : '▼';

            return (
              <div
                key={week.id}
                ref={isCurrent ? currentRef : undefined}
                className={`
                  rounded-lg border transition-all duration-200
                  ${isCurrent
                    ? 'border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-400/20'
                    : 'border-border bg-panel/50 hover:bg-panel'}
                  ${isPast && !mode ? 'opacity-60' : ''}
                `}
              >
                {/* Compact summary row */}
                <button
                  type="button"
                  onClick={() => cycleView(week.index)}
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

                  {/* Expand indicator — cycles collapsed › → compact ⊞ → expanded ▼ */}
                  <span className={`shrink-0 text-xs text-zinc-600 transition-transform duration-150`}>
                    {expandIcon}
                  </span>
                </button>

                {/* Compact 7-day row */}
                {mode === 'compact' && (
                  <div className="grid grid-cols-7 gap-1 border-t border-border px-2 pb-2 pt-2">
                    {Array.from({ length: 7 }).map((_, i) => {
                      const d = new Date(`${week.startDate}T00:00:00`);
                      d.setDate(d.getDate() + i);
                      const dateStr = d.toISOString().slice(0, 10);
                      const workout = week.workouts.find((w) => w.date === dateStr);
                      const dayActivities = activities?.filter((a) => a.startDateLocal?.startsWith(dateStr)) ?? [];
                      return (
                        <MiniDayCard
                          key={dateStr}
                          date={dateStr}
                          workout={workout}
                          activities={dayActivities}
                          isToday={dateStr === todayIso}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Expanded full DayCard grid */}
                {mode === 'expanded' && (
                  <div className="border-t border-border px-3 pb-3 pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Array.from({ length: 7 }).map((_, i) => {
                        const d = new Date(`${week.startDate}T00:00:00`);
                        d.setDate(d.getDate() + i);
                        const dateStr = d.toISOString().slice(0, 10);
                        const workout = week.workouts.find((w) => w.date === dateStr);
                        const dayActivities = activities?.filter((a) => a.startDateLocal?.startsWith(dateStr)) ?? [];

                        return (
                          <DayCard
                            key={dateStr}
                            date={dateStr}
                            workout={workout}
                            activities={dayActivities}
                            isToday={dateStr === todayIso}
                            onEffortLogged={onEffortLogged}
                          />
                        );
                      })}
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
