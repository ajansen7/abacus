#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads } from '@abacus/platform';
import {
  TYPE_PLAN_CONTEXT,
  TYPE_TRAINING_PLAN,
  TYPE_COACH_MESSAGE,
  CoachMessageMeta,
} from '../lib/types.js';

const Body = z.object({ message: z.string() });

type Action =
  | { kind: 'respond'; status: number; body: string; contentType?: string }
  | { kind: 'reject'; status: number; reason: string }
  | { kind: 'enqueue'; taskKind: string; payload: unknown; status?: number; dedupeKey?: string };

function respond(a: Action): void {
  process.stdout.write(JSON.stringify(a) + '\n');
}

async function main() {
  const body = JSON.parse(process.env.ABACUS_HTTP_BODY ?? '{}');
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    respond({ kind: 'reject', status: 400, reason: parsed.error.message });
    return;
  }

  const beads = new Beads();
  const plans = await beads.list([TYPE_TRAINING_PLAN]);
  const activePlan = plans.find((p) => p.status === 'open');
  if (!activePlan) {
    respond({ kind: 'reject', status: 404, reason: 'no active plan' });
    return;
  }

  const contexts = await beads.list([TYPE_PLAN_CONTEXT]);
  const ctx = contexts.find(
    (c) => ((c.metadata ?? {}) as Record<string, unknown>).planId === activePlan.id,
  );
  if (!ctx) {
    respond({ kind: 'reject', status: 404, reason: 'no plan-context for active plan' });
    return;
  }

  // Store message as a conversation bead so the agent can read it and reply
  const now = new Date().toISOString();
  const msgMeta = CoachMessageMeta.parse({
    planId: activePlan.id,
    role: 'user',
    content: parsed.data.message,
    createdAt: now,
  });
  const messageId = await beads.create({
    title: `coach-msg:user:${now}`,
    labels: [TYPE_COACH_MESSAGE],
    metadata: msgMeta,
  });

  // Also append to plan-context so daily_reeval continues to see coach notes
  const metadata = (ctx.metadata ?? {}) as Record<string, unknown>;
  const oldNotes = (metadata.notes as string) || '';
  const timestamp = now.slice(0, 10);
  const newEntry = `[${timestamp}] Coach Note: ${parsed.data.message}`;
  const updatedNotes = oldNotes ? `${oldNotes}\n\n${newEntry}` : newEntry;
  await beads.updateMetadata(ctx.id, {
    ...metadata,
    notes: updatedNotes,
    updatedAt: now,
  });

  // Enqueue coach_reply (not daily_reeval) so the agent generates a visible reply
  respond({
    kind: 'enqueue',
    taskKind: 'coach_reply',
    payload: { planId: activePlan.id, userMessageId: messageId },
    dedupeKey: messageId,
    status: 202,
  });
}

main().catch((err) => {
  respond({ kind: 'reject', status: 500, reason: String((err as Error).message ?? err) });
  process.exit(1);
});
