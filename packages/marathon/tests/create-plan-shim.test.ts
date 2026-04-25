import { describe, it, expect } from 'vitest';
import { createPlanCore, CreatePlanPayload } from '../scripts/create-plan-shim.js';

describe('CreatePlanPayload schema', () => {
  it('accepts a complete payload', () => {
    CreatePlanPayload.parse({
      race: { name: 'Moab', date: '2026-11-07', distance: 'marathon' },
      startDate: '2026-04-25',
      contextNotes: 'knee, partner',
      templateId: 'couch-to-marathon',
    });
  });
  it('rejects start after race', () => {
    expect(() =>
      CreatePlanPayload.parse({
        race: { name: 'X', date: '2026-04-01', distance: 'marathon' },
        startDate: '2026-05-01',
      }),
    ).toThrow();
  });
});

describe('createPlanCore', () => {
  it('creates race + plan + context, returns ids and follow-on tasks', async () => {
    const created: any[] = [];
    const beads = {
      create: async (issue: any) => {
        const id = `id-${created.length + 1}`;
        created.push({ id, ...issue });
        return id;
      },
    };
    const enqueued: any[] = [];
    const queue = {
      enqueue: async (req: any) => {
        enqueued.push(req);
        return { id: `t-${enqueued.length}` };
      },
    };
    const out = await createPlanCore({
      beads: beads as any,
      queue: queue as any,
      payload: {
        race: { name: 'Moab', date: '2026-11-07', distance: 'marathon' },
        startDate: '2026-04-25',
        contextNotes: 'knee',
      },
    });
    expect(created).toHaveLength(3);
    expect(enqueued.map((e) => e.kind)).toEqual(['backfill_strava', 'generate_plan']);
    expect(out.planId).toBe('id-2');
  });
});
