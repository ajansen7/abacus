#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads, Queue } from '@abacus/platform';
import {
  IsoDate,
  RaceMeta,
  TYPE_RACE,
  TYPE_TRAINING_PLAN,
  TYPE_PLAN_CONTEXT,
} from '../lib/types.js';

export const CreatePlanPayload = z
  .object({
    race: RaceMeta,
    startDate: IsoDate,
    contextNotes: z.string().default(''),
    templateId: z.string().optional(),
  })
  .refine((p) => p.startDate < p.race.date, 'startDate must be before race.date');
export type CreatePlanPayload = z.infer<typeof CreatePlanPayload>;

interface CreatePlanDeps {
  beads: { create: (issue: any) => Promise<string> };
  queue: { enqueue: (req: { product: string; kind: string; payload: any; dedupeKey?: string }) => Promise<{ id: string }> };
  payload: CreatePlanPayload;
}

export async function createPlanCore({ beads, queue, payload }: CreatePlanDeps) {
  const raceId = await beads.create({
    title: `race ${payload.race.name} ${payload.race.date}`,
    labels: [TYPE_RACE],
    metadata: payload.race,
  });

  // ceil so that day-6 of the last week lands on raceDate (floor leaves it one week short).
  const weeksBetween = Math.max(
    1,
    Math.ceil(
      (new Date(payload.race.date).getTime() - new Date(payload.startDate).getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    ),
  );

  const planId = await beads.create({
    title: `plan for ${payload.race.name}`,
    labels: [TYPE_TRAINING_PLAN],
    metadata: {
      raceId,
      raceDate: payload.race.date,
      startDate: payload.startDate,
      weeks: weeksBetween,
      templateId: payload.templateId,
    },
  });

  const contextId = await beads.create({
    title: `plan-context for ${planId}`,
    labels: [TYPE_PLAN_CONTEXT],
    metadata: {
      planId,
      notes: payload.contextNotes,
      updatedAt: new Date().toISOString(),
    },
  });

  const backfillTask = await queue.enqueue({
    product: 'marathon',
    kind: 'backfill_strava',
    payload: { sinceDate: payload.startDate, planId },
    dedupeKey: `backfill:${planId}`,
  });

  const generateTask = await queue.enqueue({
    product: 'marathon',
    kind: 'generate_plan',
    payload: { planId, raceId, contextId },
    dedupeKey: `generate:${planId}`,
  });

  return { raceId, planId, contextId, backfillTaskId: backfillTask.id, generateTaskId: generateTask.id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = JSON.parse(process.env.ABACUS_PAYLOAD ?? '{}');
  const payload = CreatePlanPayload.parse(raw);
  const beads = new Beads();
  // Queue requires a Beads instance and a dedupe TTL; wrap enqueue to expose the { id } contract.
  const realQueue = new Queue(beads, 3600);
  const queue = {
    enqueue: async (req: { product: string; kind: string; payload: any; dedupeKey?: string }) => {
      const result = await realQueue.enqueue(req);
      return { id: result.task.id };
    },
  };
  createPlanCore({ beads: beads as any, queue, payload }).then((r) => {
    console.log(JSON.stringify({ ok: true, ...r }));
  });
}
