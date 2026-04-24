#!/usr/bin/env tsx
/**
 * Pre-script: persist a perceived-effort log entry. Reads the task payload from
 * env (set by the platform's ClaudeRunner), validates it against the marathon
 * schema, writes a `marathon:effort-log` Beads issue. No AI; the agent reads
 * this back out via hot memory after the script exits 0.
 */
import { Beads } from '@abacus/platform';
import { EffortLogPayload, TYPE_EFFORT_LOG } from '../lib/types.js';

async function main(): Promise<void> {
  const raw = process.env.ABACUS_PAYLOAD;
  if (!raw) throw new Error('ingest-perceived-effort: ABACUS_PAYLOAD env not set');
  const payload = EffortLogPayload.parse(JSON.parse(raw));
  const beads = new Beads();
  const id = await beads.create({
    title: `Effort ${payload.score}/10 for workout ${payload.workoutId}`,
    labels: [TYPE_EFFORT_LOG, 'product:marathon'],
    metadata: {
      workoutId: payload.workoutId,
      score: payload.score,
      notes: payload.notes,
      loggedAt: new Date().toISOString(),
    },
  });
  console.log(`[ingest-effort] ${id}`);
}

main().catch((err) => {
  console.error('[ingest-effort] fatal', err);
  process.exit(1);
});
