import { describe, it, expect } from 'vitest';
import { syncStravaCore } from '../scripts/sync-strava-shim.js';

const sampleActivity = (id: number, startDate = '2026-04-28T07:00:00Z') => ({
  id,
  type: 'Run',
  start_date: startDate,
  start_date_local: startDate.replace('Z', ''),
  distance: 5000,
  moving_time: 1800,
  athlete: { id: 99 },
});

function makeBeads(planMeta: Record<string, unknown> = {}) {
  const issues: any[] = [
    {
      id: 'plan-1',
      labels: ['marathon:training-plan'],
      status: 'open',
      metadata: { startDate: '2026-04-01', ...planMeta },
    },
  ];
  return {
    issues,
    list: async (labels: string[]) =>
      labels.length === 0
        ? issues
        : issues.filter((i) => labels.every((l) => (i.labels as string[]).includes(l))),
    create: async (issue: any) => {
      const id = `sa-${issues.length + 1}`;
      issues.push({ id, ...issue });
      return id;
    },
    show: async (id: string) => {
      const found = issues.find((i) => i.id === id);
      if (!found) throw new Error(`not found: ${id}`);
      return found;
    },
    updateMetadata: async (id: string, patch: any) => {
      const i = issues.find((x) => x.id === id);
      if (!i) throw new Error(`not found: ${id}`);
      i.metadata = { ...i.metadata, ...patch };
    },
  };
}

function makeQueue() {
  const enqueued: any[] = [];
  return {
    enqueued,
    enqueue: async (req: any) => {
      enqueued.push(req);
      return { task: { id: `t-${enqueued.length}` } };
    },
  };
}

describe('syncStravaCore', () => {
  it('stores new activities and enqueues process_activity for each', async () => {
    const beads = makeBeads();
    const queue = makeQueue();
    const strava = { listActivities: async () => [sampleActivity(1), sampleActivity(2)] };

    const result = await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
      nowIso: '2026-04-29T10:00:00.000Z',
    });

    expect(result.newCount).toBe(2);
    expect(queue.enqueued).toHaveLength(2);
    expect(queue.enqueued[0].kind).toBe('process_activity');
    expect(queue.enqueued[0].payload.activityIssueId).toMatch(/^sa-/);
    expect(queue.enqueued[0].payload).not.toHaveProperty('workoutId');
  });

  it('updates lastSyncedAt on plan metadata', async () => {
    const beads = makeBeads();
    const queue = makeQueue();
    const strava = { listActivities: async () => [sampleActivity(3)] };

    await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
      nowIso: '2026-04-29T10:00:00.000Z',
    });

    const plan = beads.issues.find((i: any) => i.id === 'plan-1');
    expect(plan.metadata.lastSyncedAt).toBe('2026-04-29T10:00:00.000Z');
  });

  it('defaults sinceUnix to plan startDate when lastSyncedAt is absent', async () => {
    let capturedArgs: any;
    const beads = makeBeads();
    const queue = makeQueue();
    const strava = {
      listActivities: async (args: any) => {
        capturedArgs = args;
        return [];
      },
    };

    await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
    });

    const expected = Math.floor(new Date('2026-04-01T00:00:00Z').getTime() / 1000);
    expect(capturedArgs.afterUnix).toBe(expected);
  });

  it('skips already-stored activities (deduplication)', async () => {
    const beads = makeBeads();
    beads.issues.push({
      id: 'sa-existing',
      labels: ['marathon:strava-activity'],
      metadata: { activityId: 1 },
    });
    const queue = makeQueue();
    const strava = { listActivities: async () => [sampleActivity(1), sampleActivity(2)] };

    const result = await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
    });

    // newCount=1 (only id=2 is new), but sa-existing is unmatched so both get queued
    expect(result.newCount).toBe(1);
    expect(queue.enqueued).toHaveLength(2);
  });

  it('does not re-queue activities already matched to a plan workout', async () => {
    const beads = makeBeads();
    beads.issues.push({
      id: 'wb-1',
      labels: ['marathon:week-block'],
      metadata: { planId: 'plan-1', weekIndex: 0, theme: 'base', startDate: '2026-04-01' },
    });
    beads.issues.push({
      id: 'wo-1',
      labels: ['marathon:workout'],
      metadata: { weekBlockId: 'wb-1', date: '2026-04-01', kind: 'easy', actual: { activityId: 'sa-existing' } },
    });
    beads.issues.push({
      id: 'sa-existing',
      labels: ['marathon:strava-activity'],
      metadata: { activityId: 1 },
    });
    const queue = makeQueue();
    const strava = { listActivities: async () => [] };

    await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
    });

    expect(queue.enqueued).toHaveLength(0);
  });
});
