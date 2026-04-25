import { z } from 'zod';

export const TYPE_TRAINING_PLAN = 'marathon:training-plan';
export const TYPE_WEEK_BLOCK = 'marathon:week-block';
export const TYPE_WORKOUT = 'marathon:workout';
export const TYPE_EFFORT_LOG = 'marathon:effort-log';
export const TYPE_STRAVA_ACTIVITY = 'marathon:strava-activity';
export const TYPE_FLAG = 'marathon:flag';
export const TYPE_RACE = 'marathon:race';
export const TYPE_PLAN_CONTEXT = 'marathon:plan-context';

export const PaceMinPerKm = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/, 'pace must be MM:SS per km')
  .describe('Pace in minutes:seconds per kilometer, e.g. "5:00"');

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const TrainingPlanMeta = z.object({
  raceId: z.string().optional(),
  raceDate: IsoDate,
  goalPace: PaceMinPerKm.optional(),
  startDate: IsoDate,
  weeks: z.number().int().positive(),
  templateId: z.string().optional(),
});
export type TrainingPlanMeta = z.infer<typeof TrainingPlanMeta>;

export const WeekTheme = z.enum(['base', 'build', 'peak', 'taper']);
export type WeekTheme = z.infer<typeof WeekTheme>;

export const WeekBlockMeta = z.object({
  planId: z.string(),
  weekIndex: z.number().int().nonnegative(),
  theme: WeekTheme,
  startDate: IsoDate,
});
export type WeekBlockMeta = z.infer<typeof WeekBlockMeta>;

export const WorkoutKind = z.enum([
  'easy',
  'long',
  'tempo',
  'intervals',
  'rest',
  'cross',
  'strength',
]);
export type WorkoutKind = z.infer<typeof WorkoutKind>;

export const ActualActivityKind = z.enum([
  'run',
  'bike',
  'swim',
  'hike',
  'strength',
  'mobility',
  'other',
]);
export type ActualActivityKind = z.infer<typeof ActualActivityKind>;

export const DeviationStatus = z.enum(['met', 'partial', 'swapped', 'skipped', 'extra']);
export type DeviationStatus = z.infer<typeof DeviationStatus>;

export const WorkoutActual = z.object({
  activityId: z.string().optional(),
  activityKind: ActualActivityKind,
  source: z.enum(['strava', 'manual']),
  deviationStatus: DeviationStatus,
  durationMin: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});
export type WorkoutActual = z.infer<typeof WorkoutActual>;

export const WorkoutMeta = z.object({
  weekBlockId: z.string(),
  date: IsoDate,
  kind: WorkoutKind,
  targetDurationMin: z.number().int().positive(),
  targetPace: PaceMinPerKm.optional(),
  notes: z.string().optional(),
  completed: z.boolean().default(false),
  actual: WorkoutActual.optional(),
});
export type WorkoutMeta = z.infer<typeof WorkoutMeta>;

export const WorkoutPatch = z
  .object({
    targetDurationMin: z.number().int().positive().optional(),
    targetPace: PaceMinPerKm.optional(),
    kind: WorkoutKind.optional(),
    notes: z.string().optional(),
    completed: z.boolean().optional(),
    actual: WorkoutActual.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'patch must include at least one field');
export type WorkoutPatch = z.infer<typeof WorkoutPatch>;

export const EffortLogPayload = z.object({
  workoutId: z.string().min(1),
  score: z.number().int().min(1).max(10),
  notes: z.string().optional(),
});
export type EffortLogPayload = z.infer<typeof EffortLogPayload>;

export const StravaWebhookPayload = z
  .object({
    object_type: z.enum(['activity', 'athlete']),
    object_id: z.number().int(),
    aspect_type: z.enum(['create', 'update', 'delete']),
    owner_id: z.number().int(),
    subscription_id: z.number().int(),
    event_time: z.number().int(),
    updates: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type StravaWebhookPayload = z.infer<typeof StravaWebhookPayload>;

export const FlagMeta = z.object({
  reason: z.string().min(1),
  severity: z.enum(['info', 'warn', 'critical']).default('warn'),
  raisedAt: z.string(),
});
export type FlagMeta = z.infer<typeof FlagMeta>;

export const RaceDistance = z.enum(['5k', '10k', 'half', 'marathon', 'ultra', 'other']);
export type RaceDistance = z.infer<typeof RaceDistance>;

export const RaceMeta = z.object({
  name: z.string().min(1),
  date: IsoDate,
  distance: RaceDistance,
  location: z.string().optional(),
  goalFinishTime: z.string().regex(/^\d{1,2}:\d{2}:\d{2}$/).optional(),
  notes: z.string().optional(),
});
export type RaceMeta = z.infer<typeof RaceMeta>;

export const PlanContextMeta = z.object({
  planId: z.string().min(1),
  notes: z.string(),
  updatedAt: z.string().optional(),
});
export type PlanContextMeta = z.infer<typeof PlanContextMeta>;
