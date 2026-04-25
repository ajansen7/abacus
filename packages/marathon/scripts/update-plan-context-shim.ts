#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads } from '@abacus/platform';
import { TYPE_PLAN_CONTEXT, TYPE_TRAINING_PLAN } from '../lib/types.js';

const Body = z.object({ notes: z.string() });

type Action =
  | { kind: 'respond'; status: number; body: string }
  | { kind: 'reject'; status: number; reason: string };

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

  await beads.updateMetadata(ctx.id, {
    ...((ctx.metadata ?? {}) as Record<string, unknown>),
    notes: parsed.data.notes,
    updatedAt: new Date().toISOString(),
  });

  respond({ kind: 'respond', status: 200, body: JSON.stringify({ ok: true }) });
}

main().catch((err) => {
  respond({ kind: 'reject', status: 500, reason: String((err as Error).message ?? err) });
  process.exit(1);
});
