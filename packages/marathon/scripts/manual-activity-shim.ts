#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads, Queue } from '@abacus/platform';
import { IsoDate, TYPE_STRAVA_ACTIVITY, TYPE_WEEK_BLOCK, TYPE_WORKOUT } from '../lib/types.js';

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
export const ManualActivityRequest = z.discriminatedUnion('op', [
  AddOp,
  DeleteOp,
  ReassignOp,
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

    // Let the agent assess deviationStatus and adapt the plan — don't hardcode 'met'.
    await queue.enqueue({
      product: 'marathon',
      kind: 'process_activity',
      payload: {
        activityIssueId: req.activityIssueId,
        workoutId: req.workoutId,
      },
      dedupeKey: `manual-reassign:${req.workoutId}:${req.activityIssueId}`,
    });
    return { reassigned: { workoutId: req.workoutId, activityIssueId: req.activityIssueId } };
  }
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
