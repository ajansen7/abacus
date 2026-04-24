import { z } from 'zod';

export const TYPE_TRAINING_PLAN = 'marathon:training-plan';
export const TYPE_WEEK_BLOCK = 'marathon:week-block';
export const TYPE_WORKOUT = 'marathon:workout';
export const TYPE_EFFORT_LOG = 'marathon:effort-log';
export const TYPE_STRAVA_ACTIVITY = 'marathon:strava-activity';
export const TYPE_FLAG = 'marathon:flag';

export const PaceMinPerKm = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/, 'pace must be MM:SS per km')
  .describe('Pace in minutes:seconds per kilometer, e.g. "5:00"');

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const TrainingPlanMeta = z.object({
  raceDate: IsoDate,
  goalPace: PaceMinPerKm,
  startDate: IsoDate,
  weeks: z.number().int().positive(),
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
]);
export type WorkoutKind = z.infer<typeof WorkoutKind>;

export const WorkoutMeta = z.object({
  weekBlockId: z.string(),
  date: IsoDate,
  kind: WorkoutKind,
  targetDurationMin: z.number().int().positive(),
  targetPace: PaceMinPerKm.optional(),
  notes: z.string().optional(),
  completed: z.boolean().default(false),
});
export type WorkoutMeta = z.infer<typeof WorkoutMeta>;

export const WorkoutPatch = z
  .object({
    targetDurationMin: z.number().int().positive().optional(),
    targetPace: PaceMinPerKm.optional(),
    kind: WorkoutKind.optional(),
    notes: z.string().optional(),
    completed: z.boolean().optional(),
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
