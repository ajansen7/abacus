import { describe, it, expect } from 'vitest';
import { mapStravaTypeToActualKind } from '../lib/activity-mapping.js';

describe('mapStravaTypeToActualKind', () => {
  it.each([
    ['Run', 'run'],
    ['TrailRun', 'run'],
    ['Ride', 'bike'],
    ['VirtualRide', 'bike'],
    ['EBikeRide', 'bike'],
    ['Swim', 'swim'],
    ['Hike', 'hike'],
    ['Walk', 'hike'],
    ['WeightTraining', 'strength'],
    ['Workout', 'strength'],
    ['Yoga', 'mobility'],
    ['Crossfit', 'strength'],
    ['Rowing', 'other'],
    ['UnknownType', 'other'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapStravaTypeToActualKind(input)).toBe(expected);
  });
});
