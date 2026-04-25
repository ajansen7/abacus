import type { ActualActivityKind } from './types.js';

const RUN = new Set(['Run', 'TrailRun', 'VirtualRun']);
const BIKE = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide']);
const SWIM = new Set(['Swim']);
const HIKE = new Set(['Hike', 'Walk', 'Snowshoe']);
const STRENGTH = new Set(['WeightTraining', 'Workout', 'Crossfit', 'StairStepper']);
const MOBILITY = new Set(['Yoga', 'Pilates']);

export function mapStravaTypeToActualKind(stravaType: string): ActualActivityKind {
  if (RUN.has(stravaType)) return 'run';
  if (BIKE.has(stravaType)) return 'bike';
  if (SWIM.has(stravaType)) return 'swim';
  if (HIKE.has(stravaType)) return 'hike';
  if (STRENGTH.has(stravaType)) return 'strength';
  if (MOBILITY.has(stravaType)) return 'mobility';
  return 'other';
}
