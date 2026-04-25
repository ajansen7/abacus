#!/usr/bin/env tsx
/**
 * Marathon state shim. The platform invokes this on GET /api/marathon/state,
 * passes the query string in ABACUS_HTTP_QUERY (JSON), and streams whatever
 * JSON we write to stdout back to the caller as the response body.
 *
 * This is the marathon dashboard's only read surface. Platform stays blind
 * to domain shape; we decide what the dashboard sees.
 *
 * Output shape:
 *   {
 *     plan: { id, raceDate, goalPace, startDate, weeks, status } | null,
 *     weeks: [{ id, index, theme, startDate, workouts: [...] }],
 *     currentWeekIndex: number | null,
 *     todayIso: "YYYY-MM-DD",
 *     recentEfforts: [...],
 *     recentActivities: [...],
 *     flags: [...],
 *     recentTasks: [...],
 *   }
 */
import { Beads } from '@abacus/platform';
import {
  TYPE_EFFORT_LOG,
  TYPE_FLAG,
  TYPE_PLAN_CONTEXT,
  TYPE_RACE,
  TYPE_STRAVA_ACTIVITY,
  TYPE_TRAINING_PLAN,
  TYPE_WEEK_BLOCK,
  TYPE_WORKOUT,
} from '../lib/types.js';

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function dayDiff(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

function byUpdatedDesc(a: { updated_at?: string | undefined }, b: { updated_at?: string | undefined }): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

async function main(): Promise<void> {
  const beads = new Beads();

  const [plans, weekBlocks, workouts, efforts, activities, flags, races, planContexts] = await Promise.all([
    beads.list([TYPE_TRAINING_PLAN]),
    beads.list([TYPE_WEEK_BLOCK]),
    beads.list([TYPE_WORKOUT]),
    beads.list([TYPE_EFFORT_LOG]),
    beads.list([TYPE_STRAVA_ACTIVITY]),
    beads.list([TYPE_FLAG]),
    beads.list([TYPE_RACE]),
    beads.list([TYPE_PLAN_CONTEXT]),
  ]);

  // Pick the most recently updated open plan as the "active" plan.
  const plan =
    plans
      .filter((p) => p.status === 'open')
      .sort(byUpdatedDesc)[0] ?? null;
  const planId = plan?.id;
  const planMeta = (plan?.metadata ?? {}) as Record<string, unknown>;

  const race = plan && planMeta.raceId
    ? races.find((r) => r.id === planMeta.raceId) ?? null
    : null;
  const planContext = planId
    ? planContexts.find((c) => ((c.metadata ?? {}) as Record<string, unknown>).planId === planId) ?? null
    : null;

  const myWeeks = planId
    ? weekBlocks.filter((w) => {
        const meta = (w.metadata ?? {}) as Record<string, unknown>;
        return meta.planId === planId;
      })
    : [];

  const weekIds = new Set(myWeeks.map((w) => w.id));
  const myWorkouts = workouts.filter((w) => {
    const meta = (w.metadata ?? {}) as Record<string, unknown>;
    return typeof meta.weekBlockId === 'string' && weekIds.has(meta.weekBlockId);
  });

  const weeksShaped = myWeeks
    .map((w) => {
      const meta = (w.metadata ?? {}) as Record<string, unknown>;
      const workoutsForWeek = myWorkouts
        .filter(
          (x) =>
            ((x.metadata ?? {}) as Record<string, unknown>).weekBlockId === w.id,
        )
        .map((x): Record<string, unknown> => {
          const m = (x.metadata ?? {}) as Record<string, unknown>;
          return {
            id: x.id,
            status: x.status ?? 'open',
            title: x.title ?? '',
            ...m,
          };
        })
        .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
      return {
        id: w.id,
        status: w.status ?? 'open',
        index: Number(meta.weekIndex ?? 0),
        theme: String(meta.theme ?? ''),
        startDate: String(meta.startDate ?? ''),
        workouts: workoutsForWeek,
      };
    })
    .sort((a, b) => a.index - b.index);

  const today = todayIso();
  const currentWeek =
    weeksShaped.find(
      (w) => w.startDate && dayDiff(today, w.startDate) >= 0 && dayDiff(today, w.startDate) < 7,
    ) ?? null;

  const recentEfforts = efforts
    .sort(byUpdatedDesc)
    .slice(0, 20)
    .map((e) => ({
      id: e.id,
      status: e.status ?? 'open',
      title: e.title ?? '',
      updatedAt: e.updated_at,
      ...((e.metadata ?? {}) as Record<string, unknown>),
    }));

  const sortedActivities = activities.sort(byUpdatedDesc);
  const recentActivities = sortedActivities
    .slice(0, 10)
    .map((a) => {
      const m = (a.metadata ?? {}) as Record<string, unknown>;
      const activity = (m.activity ?? {}) as Record<string, unknown>;
      return {
        id: a.id,
        status: a.status ?? 'open',
        title: a.title ?? '',
        updatedAt: a.updated_at,
        activityId: m.activityId,
        aspectType: m.aspectType,
        name: activity.name,
        sportType: activity.sport_type,
        distance: activity.distance,
        movingTime: activity.moving_time,
        startDateLocal: activity.start_date_local,
      };
    });

  const allActivities = sortedActivities.map((a) => {
    const m = (a.metadata ?? {}) as Record<string, unknown>;
    const activity = (m.activity ?? {}) as Record<string, unknown>;
    return {
      id: a.id,
      status: a.status ?? 'open',
      title: a.title ?? '',
      updatedAt: a.updated_at,
      activityId: m.activityId,
      source: m.source ?? 'strava',
      aspectType: m.aspectType,
      name: activity.name,
      sportType: String(activity.type ?? activity.sport_type ?? ''),
      distance: activity.distance,
      movingTime: activity.moving_time,
      startDateLocal: activity.start_date_local,
    };
  });

  const flagsShaped = flags
    .sort(byUpdatedDesc)
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      status: f.status ?? 'open',
      title: f.title ?? '',
      updatedAt: f.updated_at,
      ...((f.metadata ?? {}) as Record<string, unknown>),
    }));

  const state = {
    todayIso: today,
    plan: plan
      ? {
          id: plan.id,
          status: plan.status ?? 'open',
          title: plan.title ?? '',
          ...planMeta,
        }
      : null,
    race: race ? { id: race.id, status: race.status ?? 'open', ...((race.metadata ?? {}) as object) } : null,
    planContext: planContext ? { id: planContext.id, ...((planContext.metadata ?? {}) as object) } : null,
    weeks: weeksShaped,
    currentWeekIndex: currentWeek?.index ?? null,
    recentEfforts,
    recentActivities,
    allActivities,
    flags: flagsShaped,
  };

  process.stdout.write(JSON.stringify(state));
}

main().catch((err) => {
  process.stderr.write(`[get-state] fatal ${String(err)}\n`);
  process.exit(1);
});
