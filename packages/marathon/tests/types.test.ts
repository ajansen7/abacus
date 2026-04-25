import { describe, it, expect } from 'vitest';
import {
  RaceMeta,
  PlanContextMeta,
  WorkoutMeta,
  WorkoutKind,
  ActualActivityKind,
  TYPE_RACE,
  TYPE_PLAN_CONTEXT,
} from '../lib/types.js';

describe('RaceMeta', () => {
  it('accepts a marathon with required fields', () => {
    const ok = RaceMeta.parse({
      name: 'Moab Marathon',
      date: '2026-11-07',
      distance: 'marathon',
    });
    expect(ok.name).toBe('Moab Marathon');
  });
  it('rejects a bad date', () => {
    expect(() => RaceMeta.parse({ name: 'X', date: '11/7/26', distance: 'marathon' })).toThrow();
  });
});

describe('PlanContextMeta', () => {
  it('requires a planId and notes string', () => {
    const ok = PlanContextMeta.parse({ planId: 'p1', notes: 'knee injury' });
    expect(ok.planId).toBe('p1');
  });
});

describe('WorkoutKind', () => {
  it('includes strength', () => {
    expect(WorkoutKind.parse('strength')).toBe('strength');
  });
});

describe('ActualActivityKind', () => {
  it('parses run/bike/swim/hike/strength/mobility/other', () => {
    for (const k of ['run', 'bike', 'swim', 'hike', 'strength', 'mobility', 'other']) {
      expect(ActualActivityKind.parse(k)).toBe(k);
    }
  });
});

describe('WorkoutMeta.actual', () => {
  it('accepts a workout with no actual', () => {
    WorkoutMeta.parse({
      weekBlockId: 'wb1',
      date: '2026-04-25',
      kind: 'easy',
      targetDurationMin: 40,
    });
  });
  it('accepts an actual record', () => {
    const ok = WorkoutMeta.parse({
      weekBlockId: 'wb1',
      date: '2026-04-25',
      kind: 'strength',
      targetDurationMin: 30,
      actual: {
        activityKind: 'bike',
        source: 'strava',
        deviationStatus: 'swapped',
        activityId: 'ma-1',
      },
    });
    expect(ok.actual?.deviationStatus).toBe('swapped');
  });
});

describe('type label constants', () => {
  it('exports race + plan-context labels', () => {
    expect(TYPE_RACE).toBe('marathon:race');
    expect(TYPE_PLAN_CONTEXT).toBe('marathon:plan-context');
  });
});
