#!/usr/bin/env tsx
import { Beads } from '@abacus/platform';
import { TYPE_WEEK_BLOCK, TYPE_WORKOUT, TYPE_PLAN_CONTEXT } from '../lib/types.js';

interface GenerateDeps {
  beads: Beads;
  planId: string;
  startDate: string;
  raceDate: string;
  weeks: number;
  templateId?: string;
  contextNotes: string;
}

function parseDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`);
}

function addDays(iso: string, days: number) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function generatePlanCore({ beads, planId, startDate, weeks, templateId, contextNotes }: GenerateDeps) {
  // Simple heuristic parsing based on template
  const isCompetitive = templateId === 'competitive.md' || contextNotes.toLowerCase().includes('sub-3');
  const isCouch = templateId === 'couch-to-marathon.md';
  const isTrail = contextNotes.toLowerCase().includes('trail');

  let longRunMin = isCouch ? 40 : (isCompetitive ? 80 : 60);
  const maxLongRunMin = isCouch ? 180 : (isCompetitive ? 200 : 180);

  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(startDate, w * 7);
    const pct = w / weeks;
    let theme: 'base' | 'build' | 'peak' | 'taper' = 'base';
    if (pct > 0.85) theme = 'taper';
    else if (pct > 0.70) theme = 'peak';
    else if (pct > 0.25) theme = 'build';

    const weekBlockId = await beads.create({
      title: `week ${w} ${theme} ${weekStart}`,
      labels: [TYPE_WEEK_BLOCK],
      metadata: { planId, weekIndex: w, theme, startDate: weekStart },
    });

    // Mon: Rest or Easy
    await beads.create({
      title: `workout ${addDays(weekStart, 0)} rest`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 0), kind: 'rest', targetDurationMin: 0, completed: false },
    });

    // Tue: Easy or Intervals
    let tueKind = 'easy';
    let tueMin = 30;
    if (theme === 'build' || theme === 'peak') {
      if (isCompetitive) { tueKind = 'intervals'; tueMin = 45; }
    }
    await beads.create({
      title: `workout ${addDays(weekStart, 1)} ${tueKind}`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 1), kind: tueKind, targetDurationMin: tueMin, completed: false },
    });

    // Wed: Cross/Strength
    await beads.create({
      title: `workout ${addDays(weekStart, 2)} strength`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 2), kind: 'strength', targetDurationMin: 45, completed: false },
    });

    // Thu: Tempo or Easy
    let thuKind = 'easy';
    let thuMin = 40;
    if (theme === 'build' || theme === 'peak') {
      thuKind = 'tempo';
      thuMin = 50;
    }
    await beads.create({
      title: `workout ${addDays(weekStart, 3)} ${thuKind}`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 3), kind: thuKind, targetDurationMin: thuMin, completed: false },
    });

    // Fri: Rest
    await beads.create({
      title: `workout ${addDays(weekStart, 4)} rest`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 4), kind: 'rest', targetDurationMin: 0, completed: false },
    });

    // Sat: Easy shakeout
    await beads.create({
      title: `workout ${addDays(weekStart, 5)} easy`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 5), kind: 'easy', targetDurationMin: 30, completed: false },
    });

    // Sun: Long Run
    let currentLongMin = longRunMin;
    if (theme === 'taper') {
      currentLongMin = Math.round(longRunMin * (1 - (w - (weeks * 0.85)) / (weeks * 0.15) * 0.5));
    }
    
    // Last week race
    let sunKind = 'long';
    let sunNotes = isTrail ? 'Trail run. Focus on elevation.' : undefined;
    if (w === weeks - 1) {
      sunKind = 'long';
      sunNotes = 'RACE DAY!';
      currentLongMin = 240;
    }

    await beads.create({
      title: `workout ${addDays(weekStart, 6)} ${sunKind}`,
      labels: [TYPE_WORKOUT],
      metadata: { weekBlockId, date: addDays(weekStart, 6), kind: sunKind, targetDurationMin: currentLongMin, completed: false, notes: sunNotes },
    });

    // Increase long run for next week if building
    if (theme === 'base' || theme === 'build' || theme === 'peak') {
      longRunMin = Math.min(maxLongRunMin, longRunMin + 10);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = JSON.parse(process.env.ABACUS_PAYLOAD ?? '{}');
  const beads = new Beads();
  
  (async () => {
    // Get plan details
    const plan = await beads.show(payload.planId);
    const meta = plan.metadata as Record<string, any>;
    
    // Get context notes
    const contexts = await beads.list([TYPE_PLAN_CONTEXT]);
    const ctx = contexts.find((c) => (c.metadata as any)?.planId === payload.planId);
    const notes = (ctx?.metadata as any)?.notes || '';

    await generatePlanCore({
      beads,
      planId: payload.planId,
      startDate: meta.startDate,
      raceDate: meta.raceDate,
      weeks: meta.weeks,
      templateId: meta.templateId,
      contextNotes: notes,
    });
    console.log(JSON.stringify({ ok: true }));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
