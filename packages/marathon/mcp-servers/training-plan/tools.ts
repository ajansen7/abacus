import { resolve } from 'node:path';
import { Beads, coldMemoryQuery } from '@abacus/platform';
import { z } from 'zod';
import {
  FlagMeta,
  TYPE_FLAG,
  TYPE_TRAINING_PLAN,
  TYPE_WEEK_BLOCK,
  TYPE_WORKOUT,
  WorkoutPatch,
} from '../../lib/types.js';

const beads = new Beads();
const DOLT_DIR = resolve(process.cwd(), '..', '..', '.beads', 'embeddeddolt');

export const GetPlanInput = z.object({});
export type GetPlanInput = z.infer<typeof GetPlanInput>;

export async function getPlan(): Promise<unknown> {
  const plans = await beads.list([TYPE_TRAINING_PLAN]);
  const weeks = await beads.list([TYPE_WEEK_BLOCK]);
  const workouts = await beads.list([TYPE_WORKOUT]);
  return {
    plans: plans.map((p) => ({ id: p.id, status: p.status, ...((p.metadata as object) ?? {}) })),
    weeks: weeks.map((w) => ({ id: w.id, status: w.status, ...((w.metadata as object) ?? {}) })),
    workouts: workouts.map((w) => ({
      id: w.id,
      status: w.status,
      ...((w.metadata as object) ?? {}),
    })),
  };
}

export const UpdateWorkoutInput = z.object({
  workoutId: z.string().min(1),
  patch: WorkoutPatch,
});
export type UpdateWorkoutInput = z.infer<typeof UpdateWorkoutInput>;

export async function updateWorkout(input: UpdateWorkoutInput): Promise<{ ok: true; id: string }> {
  const issue = await beads.show(input.workoutId);
  if (!issue.labels.includes(TYPE_WORKOUT)) {
    throw new Error(
      `update_workout: ${input.workoutId} is not a ${TYPE_WORKOUT} (labels: ${issue.labels.join(',')})`,
    );
  }
  await beads.updateMetadata(input.workoutId, input.patch);
  return { ok: true, id: input.workoutId };
}

export const QueryHistoryInput = z.object({
  sql: z.string().min(1),
});
export type QueryHistoryInput = z.infer<typeof QueryHistoryInput>;

export async function queryHistory(
  input: QueryHistoryInput,
): Promise<Record<string, unknown>[]> {
  return coldMemoryQuery(input.sql, { doltDir: DOLT_DIR });
}

export const FlagOvertrainingInput = z.object({
  reason: z.string().min(1),
  severity: z.enum(['info', 'warn', 'critical']).default('warn'),
});
export type FlagOvertrainingInput = z.infer<typeof FlagOvertrainingInput>;

export async function flagOvertraining(
  input: FlagOvertrainingInput,
): Promise<{ ok: true; id: string }> {
  const meta = FlagMeta.parse({
    reason: input.reason,
    severity: input.severity,
    raisedAt: new Date().toISOString(),
  });
  const id = await beads.create({
    title: `[${meta.severity}] overtraining: ${meta.reason.slice(0, 80)}`,
    labels: [TYPE_FLAG, 'product:marathon', 'concern:overtraining'],
    metadata: meta,
  });
  return { ok: true, id };
}
