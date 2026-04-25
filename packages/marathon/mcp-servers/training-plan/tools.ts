import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { promises as fs } from 'node:fs';
import { Beads, coldMemoryQuery } from '@abacus/platform';
import { z } from 'zod';
import {
  FlagMeta,
  TYPE_FLAG,
  TYPE_TRAINING_PLAN,
  TYPE_WEEK_BLOCK,
  TYPE_WORKOUT,
  TYPE_RACE,
  TYPE_PLAN_CONTEXT,
  WeekBlockMeta,
  WorkoutMeta as WorkoutMetaSchema,
  WorkoutActual,
  RaceMeta,
  TrainingPlanMeta,
  WorkoutPatch,
} from '../../lib/types.js';

const beads = new Beads();
const DOLT_DIR = resolve(process.cwd(), '..', '..', '.beads', 'embeddeddolt');
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates/plans');

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

// --- plan generation tools ---

export const CreateRaceInput = RaceMeta;
export type CreateRaceInput = z.infer<typeof CreateRaceInput>;

export async function createRace(input: CreateRaceInput): Promise<{ id: string }> {
  const id = await beads.create({
    title: `race ${input.name} ${input.date}`,
    labels: [TYPE_RACE],
    metadata: input,
  });
  return { id };
}

export const UpdatePlanMetaInput = z.object({
  planId: z.string().min(1),
  patch: TrainingPlanMeta.partial(),
});
export type UpdatePlanMetaInput = z.infer<typeof UpdatePlanMetaInput>;

export async function updatePlanMeta(input: UpdatePlanMetaInput): Promise<{ ok: true }> {
  const issue = await beads.show(input.planId);
  if (!issue.labels.includes(TYPE_TRAINING_PLAN)) {
    throw new Error(`update_plan_meta: ${input.planId} is not a ${TYPE_TRAINING_PLAN}`);
  }
  await beads.updateMetadata(input.planId, input.patch as Record<string, unknown>);
  return { ok: true };
}

export const CreateWeekBlockInput = WeekBlockMeta;
export type CreateWeekBlockInput = z.infer<typeof CreateWeekBlockInput>;

export async function createWeekBlock(input: CreateWeekBlockInput): Promise<{ id: string }> {
  const id = await beads.create({
    title: `week ${input.weekIndex} ${input.theme} ${input.startDate}`,
    labels: [TYPE_WEEK_BLOCK],
    metadata: input,
  });
  return { id };
}

export const CreateWorkoutInput = WorkoutMetaSchema.omit({ completed: true });
export type CreateWorkoutInput = z.infer<typeof CreateWorkoutInput>;

export async function createWorkout(input: CreateWorkoutInput): Promise<{ id: string }> {
  const id = await beads.create({
    title: `workout ${input.date} ${input.kind}`,
    labels: [TYPE_WORKOUT],
    metadata: { ...input, completed: false },
  });
  return { id };
}

// --- reconciliation tools ---

export const SetWorkoutActualInput = z.object({
  workoutId: z.string().min(1),
  actual: WorkoutActual,
  markCompleted: z.boolean().default(true),
});
export type SetWorkoutActualInput = z.infer<typeof SetWorkoutActualInput>;

export async function setWorkoutActual(input: SetWorkoutActualInput): Promise<{ ok: true }> {
  const issue = await beads.show(input.workoutId);
  if (!issue.labels.includes(TYPE_WORKOUT)) {
    throw new Error(`set_workout_actual: ${input.workoutId} is not a ${TYPE_WORKOUT}`);
  }
  await beads.updateMetadata(input.workoutId, {
    actual: input.actual,
    completed: input.markCompleted,
  });
  return { ok: true };
}

// --- read-only context tools ---

export const ReadPlanContextInput = z.object({ planId: z.string().min(1) });
export type ReadPlanContextInput = z.infer<typeof ReadPlanContextInput>;

export async function readPlanContext(input: ReadPlanContextInput): Promise<unknown> {
  const all = await beads.list([TYPE_PLAN_CONTEXT]);
  const match = all.find((i) => {
    const meta = i.metadata as Record<string, unknown> | null;
    return meta?.planId === input.planId;
  });
  if (!match) return null;
  return { id: match.id, ...(match.metadata as object) };
}

export const ListTemplatesInput = z.object({});
export type ListTemplatesInput = z.infer<typeof ListTemplatesInput>;

export async function listTemplates(): Promise<string[]> {
  const files = await fs.readdir(TEMPLATES_DIR);
  return files.filter((f) => f.endsWith('.md') && f !== 'README.md');
}

export const ReadTemplateInput = z.object({ name: z.string().min(1) });
export type ReadTemplateInput = z.infer<typeof ReadTemplateInput>;

export async function readTemplate(input: ReadTemplateInput): Promise<{ content: string }> {
  if (input.name.includes('/') || input.name.includes('..')) {
    throw new Error('read_template: invalid template name');
  }
  const filename = input.name.endsWith('.md') ? input.name : `${input.name}.md`;
  const content = await fs.readFile(resolve(TEMPLATES_DIR, filename), 'utf8');
  return { content };
}
