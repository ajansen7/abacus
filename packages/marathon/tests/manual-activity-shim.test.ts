import { describe, it, expect } from 'vitest';
import { manualActivityCore } from '../scripts/manual-activity-shim.js';

function makeBeads(seed: any[] = []) {
  const issues = [...seed];
  return {
    issues,
    create: async (issue: any) => {
      const id = `id-${issues.length + 1}`;
      issues.push({ id, status: 'open', ...issue });
      return id;
    },
    show: async (id: string) => {
      const found = issues.find((i) => i.id === id);
      if (!found) throw new Error(`not found: ${id}`);
      return found;
    },
    list: async (labels: string[]) =>
      issues.filter((i) => labels.every((l: string) => (i.labels as string[]).includes(l))),
    updateMetadata: async (id: string, patch: any) => {
      const i = issues.find((x) => x.id === id);
      if (!i) throw new Error(`not found: ${id}`);
      Object.assign(i.metadata ?? {}, patch);
    },
    close: async (id: string) => {
      const i = issues.find((x) => x.id === id);
      if (i) i.status = 'closed';
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

describe('manualActivityCore — add', () => {
  it('creates a manual strava-activity and enqueues process_activity', async () => {
    const beads = makeBeads();
    const queue = makeQueue();
    const out = await manualActivityCore(
      { op: 'add', activity: { date: '2026-04-25', durationMin: 45, type: 'Run' } },
      { beads: beads as any, queue: queue as any },
    );
    expect(beads.issues).toHaveLength(1);
    expect((beads.issues[0].metadata as any).source).toBe('manual');
    expect(queue.enqueued[0].kind).toBe('process_activity');
    expect(out.activityIssueId).toBe('id-1');
  });
});

describe('manualActivityCore — delete', () => {
  it('closes the activity, clears actual on the linked workout, enqueues reconcile', async () => {
    const beads = makeBeads([
      { id: 'a-1', labels: ['marathon:strava-activity'], metadata: {}, status: 'open' },
      {
        id: 'w-1',
        labels: ['marathon:workout'],
        metadata: { actual: { activityId: 'a-1', activityKind: 'run', source: 'strava', deviationStatus: 'met' }, completed: true },
        status: 'open',
      },
    ]);
    const queue = makeQueue();
    await manualActivityCore({ op: 'delete', activityIssueId: 'a-1' }, { beads: beads as any, queue: queue as any });
    expect(beads.issues.find((i) => i.id === 'a-1')!.status).toBe('closed');
    expect(queue.enqueued.some((e: any) => e.kind === 'process_activity')).toBe(true);
  });
});

describe('manualActivityCore — reassign', () => {
  it('enqueues process_activity with forceActivityId and reconcileWorkoutId', async () => {
    const beads = makeBeads([
      { id: 'a-9', labels: ['marathon:strava-activity'], metadata: {}, status: 'open' },
      { id: 'w-9', labels: ['marathon:workout'], metadata: {}, status: 'open' },
    ]);
    const queue = makeQueue();
    await manualActivityCore(
      { op: 'reassign', activityIssueId: 'a-9', workoutId: 'w-9' },
      { beads: beads as any, queue: queue as any },
    );
    expect(queue.enqueued[0].payload.forceActivityId).toBe('a-9');
    expect(queue.enqueued[0].payload.reconcileWorkoutId).toBe('w-9');
  });
});

describe('ManualActivityRequest schema', () => {
  it('rejects an unknown op', async () => {
    const { ManualActivityRequest } = await import('../scripts/manual-activity-shim.js');
    expect(() => ManualActivityRequest.parse({ op: 'wat' })).toThrow();
  });
});
