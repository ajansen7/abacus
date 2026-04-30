#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads, Queue } from '@abacus/platform';
import { createStravaClient, type StravaClient } from '../lib/strava-client.js';
import { backfillCore } from './backfill-strava.js';
import { TYPE_STRAVA_ACTIVITY, TYPE_WEEK_BLOCK, TYPE_WORKOUT } from '../lib/types.js';

type Action =
  | { kind: 'respond'; status: number; body: string; contentType?: string }
  | { kind: 'reject'; status: number; reason: string };

function respond(action: Action): void {
  process.stdout.write(JSON.stringify(action) + '\n');
}

const SyncPayload = z.object({ planId: z.string().min(1) });

interface SyncDeps {
  beads: {
    list: (labels: string[]) => Promise<any[]>;
    create: (issue: any) => Promise<string>;
    show: (id: string) => Promise<any>;
    updateMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>;
  };
  queue: { enqueue: (req: any) => Promise<{ task: { id: string } }> };
  strava: Pick<StravaClient, 'listActivities'>;
  planId: string;
  nowIso?: string;
}

export async function syncStravaCore({ beads, queue, strava, planId, nowIso }: SyncDeps) {
  const plan = await beads.show(planId);
  const meta = (plan.metadata ?? {}) as Record<string, unknown>;
  const startDate = meta.startDate as string;
  const lastSyncedAt = (meta.lastSyncedAt as string | undefined) ?? `${startDate}T00:00:00Z`;
  const syncStart = nowIso ?? new Date().toISOString();

  // Fetch any new activities from Strava since last sync.
  const sinceUnix = Math.floor(new Date(lastSyncedAt).getTime() / 1000);
  const { createdIds } = await backfillCore({ beads, strava, sinceUnix });

  // Find existing activities that have never been reconciled against a workout.
  // Build the set of activity Beads IDs already referenced in any active-plan workout's actual.
  const allIssues = await beads.list([]);
  const weekBlocks = allIssues.filter((i: any) => (i.labels ?? []).includes(TYPE_WEEK_BLOCK));
  const planWbIds = new Set(
    weekBlocks
      .filter((wb: any) => (wb.metadata as Record<string, unknown>)?.planId === planId)
      .map((wb: any) => wb.id),
  );
  const workouts = allIssues.filter((i: any) => (i.labels ?? []).includes(TYPE_WORKOUT));
  const alreadyMatchedActivityIds = new Set<string>();
  for (const w of workouts) {
    const wMeta = (w.metadata ?? {}) as Record<string, unknown>;
    if (!planWbIds.has(wMeta.weekBlockId as string)) continue;
    const actual = wMeta.actual as Record<string, unknown> | undefined;
    if (actual?.activityId) alreadyMatchedActivityIds.add(actual.activityId as string);
  }

  // Queue newly backfilled activities + any previously stored but unreconciled ones.
  const newIdSet = new Set(createdIds);
  const allActivities = allIssues.filter((i: any) => (i.labels ?? []).includes(TYPE_STRAVA_ACTIVITY));
  const toQueue: string[] = [...createdIds];
  for (const act of allActivities) {
    if (!newIdSet.has(act.id) && !alreadyMatchedActivityIds.has(act.id)) {
      toQueue.push(act.id);
    }
  }

  for (const activityIssueId of toQueue) {
    await queue.enqueue({
      product: 'marathon',
      kind: 'process_activity',
      payload: { activityIssueId },
      dedupeKey: `sync-activity:${activityIssueId}`,
    });
  }

  await beads.updateMetadata(planId, { lastSyncedAt: syncStart });

  return { newCount: createdIds.length, queuedCount: toQueue.length };
}

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
  const result = SyncPayload.safeParse(parsed);
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
  const strava = createStravaClient({
    clientId: process.env.STRAVA_CLIENT_ID!,
    clientSecret: process.env.STRAVA_CLIENT_SECRET!,
    refreshToken: process.env.STRAVA_REFRESH_TOKEN!,
  });

  try {
    const out = await syncStravaCore({ beads: beads as any, queue, strava, planId: result.data.planId });
    respond({ kind: 'respond', status: 200, body: JSON.stringify({ ok: true, ...out }) });
  } catch (err) {
    respond({ kind: 'reject', status: 500, reason: String((err as Error).message ?? err) });
  }
}

main().catch((err) => {
  respond({ kind: 'reject', status: 500, reason: String(err) });
  process.exit(1);
});
