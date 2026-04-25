import { describe, it, expect } from 'vitest';
import { backfillCore } from '../scripts/backfill-strava.js';

const sampleActivity = (id: number) => ({
  id,
  type: 'Run',
  start_date: '2026-04-01T07:00:00Z',
  start_date_local: '2026-04-01T01:00:00',
  distance: 5000,
  moving_time: 1800,
});

describe('backfillCore', () => {
  it('writes one issue per activity on first run', async () => {
    const created: any[] = [];
    const existing = new Set<string>();
    const beadsLike = {
      list: async () => [],
      create: async (issue: any) => {
        const id = `sa-${created.length + 1}`;
        created.push({ id, ...issue });
        existing.add(String(issue.metadata.activityId));
        return id;
      },
    };
    const stravaLike = {
      listActivities: async () => [sampleActivity(1), sampleActivity(2), sampleActivity(3)],
    };
    await backfillCore({ beads: beadsLike as any, strava: stravaLike as any, sinceUnix: 0 });
    expect(created).toHaveLength(3);
  });

  it('does not duplicate on second run', async () => {
    const seenIds = new Set<number>([1, 2]);
    const created: any[] = [];
    const beadsLike = {
      list: async () => Array.from(seenIds).map((id) => ({
        id: `sa-${id}`,
        metadata: { activityId: id },
      })),
      create: async (issue: any) => {
        const id = `sa-${created.length + 100}`;
        created.push({ id, ...issue });
        return id;
      },
    };
    const stravaLike = {
      listActivities: async () => [sampleActivity(1), sampleActivity(2), sampleActivity(3)],
    };
    await backfillCore({ beads: beadsLike as any, strava: stravaLike as any, sinceUnix: 0 });
    expect(created).toHaveLength(1);
    expect(created[0].metadata.activityId).toBe(3);
  });
});
