#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads, Queue } from '@abacus/platform';
import { IsoDate, TYPE_STRAVA_ACTIVITY, TYPE_WEEK_BLOCK, TYPE_WORKOUT } from '../lib/types.js';
import { mapStravaTypeToActualKind } from '../lib/activity-mapping.js';

// --- Output helpers (match strava-webhook-shim.ts pattern) ---
type Action =
  | { kind: 'respond'; status: number; body: string; contentType?: string }
  | { kind: 'reject'; status: number; reason: string };

function respond(action: Action): void {
  process.stdout.write(JSON.stringify(action) + '\n');
}

// --- Input schemas ---
const AddOp = z.object({
  op: z.literal('add'),
  activity: z.object({
    date: IsoDate,
    durationMin: z.number().int().positive(),
    type: z.string().min(1),
    distanceM: z.number().nonnegative().optional(),
    notes: z.string().optional(),
  }),
});
const DeleteOp = z.object({ op: z.literal('delete'), activityIssueId: z.string().min(1) });
const ReassignOp = z.object({
  op: z.literal('reassign'),
  activityIssueId: z.string().min(1),
  workoutId: z.string().min(1),
});
const InsertAndMatchOp = z.object({
  op: z.literal('insert-and-match'),
  activityIssueId: z.string().min(1),
  weekBlockId: z.string().min(1),
  date: IsoDate,
});
export const ManualActivityRequest = z.discriminatedUnion('op', [
  AddOp,
  DeleteOp,
  ReassignOp,
  InsertAndMatchOp,
]);
export type ManualActivityRequest = z.infer<typeof ManualActivityRequest>;

// --- Core logic (exported for testing) ---
interface Deps {
  beads: {
    create: (issue: any) => Promise<string>;
    show: (id: string) => Promise<any>;
    list: (labels: string[]) => Promise<any[]>;
    updateMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>;
    close: (id: string) => Promise<void>;
  };
  queue: { enqueue: (req: any) => Promise<{ task: { id: string } }> };
}

export async function manualActivityCore(req: ManualActivityRequest, { beads, queue }: Deps) {
  if (req.op === 'add') {
    const eventTimeUnix = Math.floor(new Date(`${req.activity.date}T12:00:00Z`).getTime() / 1000);
    const id = await beads.create({
      title: `manual ${req.activity.type} ${req.activity.date}`,
      labels: [TYPE_STRAVA_ACTIVITY],
      metadata: {
        activityId: `manual-${eventTimeUnix}-${Math.floor(Math.random() * 1e6)}`,
        aspectType: 'create',
        ownerId: 0,
        subscriptionId: 0,
        eventTimeUnix,
        fetchedAt: new Date().toISOString(),
        offline: true,
        source: 'manual',
        activity: {
          start_date: `${req.activity.date}T12:00:00Z`,
          start_date_local: `${req.activity.date}T12:00:00`,
          type: req.activity.type,
          moving_time: req.activity.durationMin * 60,
          distance: req.activity.distanceM ?? 0,
          description: req.activity.notes,
        },
      },
    });
    await queue.enqueue({
      product: 'marathon',
      kind: 'process_activity',
      payload: { manualActivityIssueId: id, date: req.activity.date },
      dedupeKey: `manual-add:${id}`,
    });
    return { activityIssueId: id };
  }

  if (req.op === 'delete') {
    const issue = await beads.show(req.activityIssueId);
    if (!issue.labels.includes(TYPE_STRAVA_ACTIVITY)) {
      throw new Error(`not a strava-activity: ${req.activityIssueId}`);
    }
    const workouts = await beads.list([TYPE_WORKOUT]);
    for (const w of workouts) {
      const meta = w.metadata as Record<string, any> | null;
      if (meta?.actual?.activityId === req.activityIssueId) {
        await beads.updateMetadata(w.id, { actual: undefined as unknown, completed: false });
        await queue.enqueue({
          product: 'marathon',
          kind: 'process_activity',
          payload: { reconcileWorkoutId: w.id, reason: 'manual-delete' },
          dedupeKey: `manual-del:${req.activityIssueId}`,
        });
      }
    }
    await beads.close(req.activityIssueId);
    return { closed: req.activityIssueId };
  }

  if (req.op === 'reassign') {
    const workout = await beads.show(req.workoutId);
    if (!workout.labels.includes(TYPE_WORKOUT)) {
      throw new Error(`not a workout: ${req.workoutId}`);
    }
    const activity = await beads.show(req.activityIssueId);
    if (!activity.labels.includes(TYPE_STRAVA_ACTIVITY)) {
      throw new Error(`not a strava-activity: ${req.activityIssueId}`);
    }

    // Set actual directly so the workout is immediately marked as matched.
    const actMeta = (activity.metadata ?? {}) as Record<string, any>;
    const actData = (actMeta.activity ?? {}) as Record<string, any>;
    const sportType = String(actData.type ?? actData.sport_type ?? '');
    const activityKind = mapStravaTypeToActualKind(sportType);
    const durationMin = actData.moving_time ? Math.round(Number(actData.moving_time) / 60) : undefined;

    await beads.updateMetadata(req.workoutId, {
      actual: {
        activityId: req.activityIssueId,
        activityKind,
        source: actMeta.source ?? 'strava',
        deviationStatus: 'met',
        ...(durationMin !== undefined ? { durationMin } : {}),
      },
      completed: true,
    });

    // Enqueue reeval so the agent can adjust if needed
    await queue.enqueue({
      product: 'marathon',
      kind: 'daily_reeval',
      payload: {
        reconcileWorkoutId: req.workoutId,
        forceActivityId: req.activityIssueId,
        reason: 'manual-reassign',
      },
      dedupeKey: `manual-reassign:${req.workoutId}:${req.activityIssueId}`,
    });
    return { reassigned: { workoutId: req.workoutId, activityIssueId: req.activityIssueId } };
  }

  // insert-and-match: create a new workout on a date with no existing workout,
  // assign the activity as its actual, and trigger rebalancing.
  const weekBlock = await beads.show(req.weekBlockId);
  if (!weekBlock.labels.includes(TYPE_WEEK_BLOCK)) {
    throw new Error(`not a week-block: ${req.weekBlockId}`);
  }
  const activity = await beads.show(req.activityIssueId);
  if (!activity.labels.includes(TYPE_STRAVA_ACTIVITY)) {
    throw new Error(`not a strava-activity: ${req.activityIssueId}`);
  }
  const actMeta = (activity.metadata ?? {}) as Record<string, any>;
  const actData = (actMeta.activity ?? {}) as Record<string, any>;
  const sportType = String(actData.type ?? actData.sport_type ?? '');
  const activityKind = mapStravaTypeToActualKind(sportType);
  const durationMin = actData.moving_time ? Math.round(Number(actData.moving_time) / 60) : 30;

  // Map activity kind → workout kind (best-effort, not a judgment call)
  const kindMap: Record<string, string> = {
    run: 'easy', bike: 'cross', swim: 'cross', hike: 'cross',
    strength: 'strength', mobility: 'cross', other: 'cross',
  };
  const workoutKind = kindMap[activityKind] ?? 'cross';

  const workoutId = await beads.create({
    title: `workout ${req.date} ${workoutKind} (inserted)`,
    labels: [TYPE_WORKOUT],
    metadata: {
      weekBlockId: req.weekBlockId,
      date: req.date,
      kind: workoutKind,
      targetDurationMin: durationMin,
      completed: true,
      actual: {
        activityId: req.activityIssueId,
        activityKind,
        source: actMeta.source ?? 'strava',
        deviationStatus: 'extra',
        durationMin,
      },
    },
  });

  // Enqueue daily_reeval so the agent can rebalance the rest of the week + next week
  await queue.enqueue({
    product: 'marathon',
    kind: 'daily_reeval',
    payload: {
      reason: 'insert-and-match',
      insertedWorkoutId: workoutId,
      activityIssueId: req.activityIssueId,
    },
    dedupeKey: `insert-match:${req.activityIssueId}`,
  });

  return { inserted: { workoutId, activityIssueId: req.activityIssueId } };
}

// --- CLI entry point ---
async function main(): Promise<void> {
  const body = process.env.ABACUS_HTTP_BODY ?? '';
  if (!body) {
    respond({ kind: 'reject', status: 400, reason: 'empty body' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    respond({ kind: 'reject', status: 400, reason: 'invalid json' });
    return;
  }
  const result = ManualActivityRequest.safeParse(parsed);
  if (!result.success) {
    respond({ kind: 'reject', status: 400, reason: result.error.message });
    return;
  }
  const beads = new Beads();
  const realQueue = new Queue(beads, 3600);
  const queue = {
    enqueue: async (req: any) => {
      const r = await realQueue.enqueue(req);
      return { task: { id: r.task.id } };
    },
  };
  try {
    const out = await manualActivityCore(result.data, { beads: beads as any, queue });
    respond({ kind: 'respond', status: 200, body: JSON.stringify({ ok: true, ...out }) });
  } catch (err) {
    respond({ kind: 'reject', status: 500, reason: String((err as Error).message ?? err) });
  }
}

main().catch((err) => {
  respond({ kind: 'reject', status: 500, reason: String(err) });
  process.exit(1);
});
