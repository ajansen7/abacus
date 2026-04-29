#!/usr/bin/env tsx
/**
 * One-shot enrichment script for an existing plan that has no workout notes.
 *
 * What it does:
 *   1. Finds the active training plan and its week-blocks / workouts.
 *   2. For every workout that is missing notes (and has no `actual` recorded),
 *      computes contextual notes and patches them via beads.updateMetadata.
 *   3. Creates any missing week-blocks up to the correct total week count
 *      (ceil of raceDate − startDate in weeks), including the race-week.
 *   4. Updates plan metadata `weeks` if the correct count differs from stored.
 *
 * Usage:
 *   pnpm --filter @abacus-products/marathon exec tsx scripts/enrich-plan-notes.ts
 *   pnpm --filter @abacus-products/marathon exec tsx scripts/enrich-plan-notes.ts --dry-run
 */
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Beads } from '@abacus/platform';
import {
  TYPE_TRAINING_PLAN, TYPE_WEEK_BLOCK, TYPE_WORKOUT, TYPE_PLAN_CONTEXT, TYPE_RACE,
} from '../lib/types.js';
import { workoutNotes } from '../lib/workout-notes.js';

// Load .env.local so BEADS_DIR etc. are set even when running standalone.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
async function loadEnvLocal() {
  const p = resolve(REPO_ROOT, '.env.local');
  try { await access(p); } catch { return; }
  const raw = await readFile(p, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] ??= val;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function correctWeekCount(startDate: string, raceDate: string): number {
  return Math.max(
    1,
    Math.ceil(
      (new Date(raceDate).getTime() - new Date(startDate).getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    ),
  );
}

async function main() {
  await loadEnvLocal();
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('[enrich] DRY RUN — no writes will occur');

  const beads = new Beads();
  const allIssues = await beads.list();

  const plans = allIssues.filter((i) => i.labels.includes(TYPE_TRAINING_PLAN) && i.status === 'open');
  if (plans.length === 0) throw new Error('No active training plan found');
  const plan = plans.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]!;
  const planMeta = (plan.metadata ?? {}) as Record<string, unknown>;
  const planId = plan.id;
  const startDate = planMeta.startDate as string;
  const raceDate = planMeta.raceDate as string;
  const storedWeeks = planMeta.weeks as number;
  const templateId = planMeta.templateId as string | undefined;

  // Determine correct week count
  const correctWeeks = correctWeekCount(startDate, raceDate);
  console.log(`[enrich] Plan: ${plan.title} (${planId})`);
  console.log(`[enrich] startDate=${startDate} raceDate=${raceDate}`);
  console.log(`[enrich] storedWeeks=${storedWeeks} correctWeeks=${correctWeeks}`);

  // Load plan context and race for richer detection
  const planContexts = allIssues.filter((i) => i.labels.includes(TYPE_PLAN_CONTEXT));
  const ctx = planContexts.find((c) => (c.metadata as Record<string, unknown>)?.planId === planId);
  const contextNotes = (ctx?.metadata as Record<string, unknown>)?.notes as string ?? '';

  const races = allIssues.filter((i) => i.labels.includes(TYPE_RACE));
  const race = planMeta.raceId
    ? races.find((r) => r.id === planMeta.raceId)
    : null;
  const raceName = (race?.metadata as Record<string, unknown>)?.name as string ?? race?.title ?? '';

  // Combine all searchable text for flag detection
  const searchableText = `${contextNotes} ${plan.title ?? ''} ${raceName}`;

  // Derive flags from template + context
  const tid = (templateId ?? '').toLowerCase().replace(/\.md$/, '');
  const isCouch = tid === 'couch-to-marathon';
  const isCompetitive = tid === 'competitive' || /sub-3/i.test(searchableText);
  const isTrail = /trail/i.test(searchableText);
  const hasKneeIssue = /knee|kneecap|patell/i.test(searchableText);
  const hasBuddy = /buddy|partner|together/i.test(searchableText);

  console.log(`[enrich] flags: isCouch=${isCouch} isTrail=${isTrail} hasKneeIssue=${hasKneeIssue} hasBuddy=${hasBuddy}`);

  // Load week-blocks for this plan
  const weekBlocks = allIssues.filter((i) => {
    if (!i.labels.includes(TYPE_WEEK_BLOCK)) return false;
    return (i.metadata as Record<string, unknown>)?.planId === planId;
  });
  const existingIndices = new Set(weekBlocks.map((w) => (w.metadata as Record<string, unknown>)?.weekIndex as number));
  console.log(`[enrich] Existing week-blocks: ${weekBlocks.length} (indices 0–${Math.max(-1, ...existingIndices)})`);

  // Load workouts for these week-blocks
  const weekBlockIds = new Set(weekBlocks.map((w) => w.id));
  const workouts = allIssues.filter((i) => {
    if (!i.labels.includes(TYPE_WORKOUT)) return false;
    return weekBlockIds.has((i.metadata as Record<string, unknown>)?.weekBlockId as string);
  });
  console.log(`[enrich] Existing workouts: ${workouts.length}`);

  // 1. Patch notes into existing workouts that lack them
  let patched = 0;
  let skipped = 0;
  for (const wo of workouts) {
    const m = (wo.metadata ?? {}) as Record<string, unknown>;
    // Skip if notes already set, or if actual data exists (agent may have set notes)
    if (m.notes || m.actual) { skipped++; continue; }
    const kind = m.kind as string;
    if (kind === 'rest') { skipped++; continue; }

    // Find week-block for this workout to get theme + weekIndex
    const wb = weekBlocks.find((w) => w.id === m.weekBlockId);
    if (!wb) { skipped++; continue; }
    const wbMeta = (wb.metadata ?? {}) as Record<string, unknown>;
    const weekNum = wbMeta.weekIndex as number ?? 0;
    const theme = wbMeta.theme as 'base' | 'build' | 'peak' | 'taper' ?? 'base';

    const notes = workoutNotes({
      kind: kind as Parameters<typeof workoutNotes>[0]['kind'],
      theme, weekNum, totalWeeks: correctWeeks,
      durationMin: (m.targetDurationMin as number) || 30,
      isCouch, isCompetitive, isTrail, hasKneeIssue, hasBuddy,
    });
    if (!notes) { skipped++; continue; }

    if (!dryRun) {
      await beads.updateMetadata(wo.id, { notes });
    } else {
      console.log(`[enrich] [DRY] Would patch ${wo.id} (${kind}, week ${weekNum}, ${theme})`);
    }
    patched++;
  }
  console.log(`[enrich] Notes patched: ${patched}, skipped: ${skipped}`);

  // 2. Create missing week-blocks AND fill week-blocks that have no workouts.
  // A week-block can exist but be empty if the generator crashed mid-week.
  const workoutsByBlockId = new Map<string, number>();
  for (const wo of workouts) {
    const bid = (wo.metadata as Record<string, unknown>)?.weekBlockId as string;
    if (bid) workoutsByBlockId.set(bid, (workoutsByBlockId.get(bid) ?? 0) + 1);
  }

  // Indices that need workouts: missing blocks + existing blocks with 0 workouts
  const emptyBlocksByIndex = new Map<number, string>(); // index → weekBlockId
  for (const wb of weekBlocks) {
    const idx = (wb.metadata as Record<string, unknown>)?.weekIndex as number;
    if ((workoutsByBlockId.get(wb.id) ?? 0) === 0) {
      emptyBlocksByIndex.set(idx, wb.id);
    }
  }
  if (emptyBlocksByIndex.size > 0) {
    console.log(`[enrich] Week-blocks with no workouts: ${[...emptyBlocksByIndex.keys()].sort((a, b) => a - b).join(', ')}`);
  }

  const missingIndices: number[] = [];
  for (let w = 0; w < correctWeeks; w++) {
    if (!existingIndices.has(w) || emptyBlocksByIndex.has(w)) missingIndices.push(w);
  }
  if (missingIndices.length === 0) {
    console.log('[enrich] No missing weeks — plan is complete');
  } else {
    console.log(`[enrich] Creating/filling ${missingIndices.length} week(s): ${missingIndices.join(', ')}`);
  }

  for (const w of missingIndices) {
    const weekStart = addDays(startDate, w * 7);
    const pct = w / correctWeeks;
    let theme: 'base' | 'build' | 'peak' | 'taper' = 'base';
    if (pct > 0.85) theme = 'taper';
    else if (pct > 0.70) theme = 'peak';
    else if (pct > 0.25) theme = 'build';

    const noteCtx = {
      theme, weekNum: w, totalWeeks: correctWeeks,
      isTrail, isCouch, isCompetitive, hasKneeIssue, hasBuddy,
    };

    const isLastWeek = w === correctWeeks - 1;

    // Compute long-run duration for this week by replaying the progression
    let longRunMin = isCouch ? 40 : isCompetitive ? 80 : 60;
    const maxLongRunMin = isCouch ? 180 : isCompetitive ? 200 : 180;
    // Find the highest completed base/build/peak week's long run duration to anchor
    const priorLongWorkouts = workouts
      .filter((wo) => {
        const m = (wo.metadata ?? {}) as Record<string, unknown>;
        const wb = weekBlocks.find((x) => x.id === m.weekBlockId);
        if (!wb) return false;
        const wbM = (wb.metadata ?? {}) as Record<string, unknown>;
        const idx = wbM.weekIndex as number ?? 0;
        return m.kind === 'long' && idx < w;
      })
      .map((wo) => ({ idx: (((wo.metadata ?? {}) as Record<string, unknown>).weekBlockId as string), dur: ((wo.metadata ?? {}) as Record<string, unknown>).targetDurationMin as number ?? 0 }));

    if (priorLongWorkouts.length > 0) {
      const maxPrior = Math.max(...priorLongWorkouts.map((x) => x.dur));
      longRunMin = Math.min(maxLongRunMin, maxPrior + 10);
    } else {
      for (let i = 0; i < w; i++) {
        const p = i / correctWeeks;
        const t: 'base' | 'build' | 'peak' | 'taper' = p > 0.85 ? 'taper' : p > 0.70 ? 'peak' : p > 0.25 ? 'build' : 'base';
        if (t !== 'taper') longRunMin = Math.min(maxLongRunMin, longRunMin + 10);
      }
    }

    if (theme === 'taper') {
      const taperStart = Math.floor(correctWeeks * 0.85);
      const taperFraction = (w - taperStart) / (correctWeeks - taperStart);
      longRunMin = Math.round(longRunMin * (1 - taperFraction * 0.55));
    }
    longRunMin = Math.max(30, longRunMin);

    console.log(`[enrich] Week ${w} (${theme}, ${weekStart}): longRunMin=${longRunMin}`);

    if (dryRun) {
      const action = emptyBlocksByIndex.has(w) ? 'fill workouts for' : 'create week-block + workouts for';
      console.log(`[enrich] [DRY] Would ${action} week ${w}`);
      continue;
    }

    const strengthMin = isCouch ? 35 : (theme === 'peak' || theme === 'taper') ? 35 : 45;
    const thuKind: 'easy' | 'tempo' = (!isLastWeek && (theme === 'build' || theme === 'peak')) ? 'tempo' : 'easy';
    const thuMin = (!isLastWeek && (theme === 'build' || theme === 'peak')) ? 50 : (isLastWeek ? 30 : 40);
    const tueKind: 'easy' | 'intervals' = (!isLastWeek && (theme === 'build' || theme === 'peak') && isCompetitive) ? 'intervals' : 'easy';
    const tueMin = tueKind === 'intervals' ? 45 : 30;
    const satMin = isLastWeek ? 20 : 30;

    // Reuse existing week-block if present (it just has no workouts), otherwise create one.
    const weekBlockId = emptyBlocksByIndex.get(w) ?? await beads.create({
      title: `week ${w} ${theme} ${weekStart}`,
      labels: [TYPE_WEEK_BLOCK],
      metadata: { planId, weekIndex: w, theme, startDate: weekStart },
    });

    await beads.create({
      title: `workout ${addDays(weekStart, 0)} rest`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 0), kind: 'rest', targetDurationMin: 0, completed: false },
    });
    await beads.create({
      title: `workout ${addDays(weekStart, 1)} ${tueKind}`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 1), kind: tueKind, targetDurationMin: tueMin, completed: false, notes: workoutNotes({ kind: tueKind, durationMin: tueMin, ...noteCtx }) },
    });
    await beads.create({
      title: `workout ${addDays(weekStart, 2)} strength`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 2), kind: 'strength', targetDurationMin: strengthMin, completed: false, notes: workoutNotes({ kind: 'strength', durationMin: strengthMin, ...noteCtx }) },
    });
    await beads.create({
      title: `workout ${addDays(weekStart, 3)} ${thuKind}`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 3), kind: thuKind, targetDurationMin: thuMin, completed: false, notes: workoutNotes({ kind: thuKind, durationMin: thuMin, ...noteCtx }) },
    });
    await beads.create({
      title: `workout ${addDays(weekStart, 4)} rest`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 4), kind: 'rest', targetDurationMin: 0, completed: false },
    });
    await beads.create({
      title: `workout ${addDays(weekStart, 5)} easy`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 5), kind: 'easy', targetDurationMin: satMin, completed: false,
        notes: isLastWeek
          ? "Race-eve shakeout — 15–20 min very easy. Shake out the legs, no effort at all. Lay out your gear tonight."
          : workoutNotes({ kind: 'easy', durationMin: satMin, ...noteCtx }),
      },
    });

    if (isLastWeek) {
      await beads.create({
        title: `workout ${addDays(weekStart, 6)} long`,
        labels: [TYPE_WORKOUT],
        metadata: {
          weekBlockId, date: addDays(weekStart, 6), kind: 'long', targetDurationMin: 240, completed: false,
          notes: `RACE DAY — ${raceName || plan.title || 'Race day'}!\nTrust your training. Start easy — the first miles should feel effortless.\nFuel early and often (every 30–45 min). Walk the steep climbs confidently.\nYou've got this.`,
        },
      });
    } else {
      await beads.create({
        title: `workout ${addDays(weekStart, 6)} long`,
        labels: [TYPE_WORKOUT],
        metadata: { weekBlockId, date: addDays(weekStart, 6), kind: 'long', targetDurationMin: longRunMin, completed: false, notes: workoutNotes({ kind: 'long', durationMin: longRunMin, ...noteCtx }) },
      });
    }
  }

  // 3. Update plan metadata if week count changed
  if (correctWeeks !== storedWeeks && !dryRun) {
    await beads.updateMetadata(planId, { weeks: correctWeeks });
    console.log(`[enrich] Updated plan weeks: ${storedWeeks} → ${correctWeeks}`);
  } else if (correctWeeks !== storedWeeks) {
    console.log(`[enrich] [DRY] Would update plan weeks: ${storedWeeks} → ${correctWeeks}`);
  }

  console.log('[enrich] Done.');
}

main().catch((err) => {
  console.error('[enrich] fatal:', err);
  process.exit(1);
});
