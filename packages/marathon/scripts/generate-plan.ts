#!/usr/bin/env tsx
import { Beads } from '@abacus/platform';
import { TYPE_WEEK_BLOCK, TYPE_WORKOUT, TYPE_PLAN_CONTEXT } from '../lib/types.js';
import { workoutNotes } from '../lib/workout-notes.js';

interface GenerateDeps {
  beads: Beads;
  planId: string;
  startDate: string;
  raceDate: string;
  weeks: number;
  templateId?: string;
  contextNotes: string;
  /** Race or plan title — used for trail detection when context notes don't mention it. */
  planTitle?: string | undefined;
}

function parseDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`);
}

function addDays(iso: string, days: number) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function generatePlanCore({
  beads, planId, startDate, weeks, templateId, contextNotes, planTitle,
}: GenerateDeps) {
  // Normalise templateId — stored values may or may not include the .md extension.
  const tid = (templateId ?? '').toLowerCase().replace(/\.md$/, '');
  const isCompetitive = tid === 'competitive' || contextNotes.toLowerCase().includes('sub-3');
  const isCouch = tid === 'couch-to-marathon';
  const searchableText = `${contextNotes} ${planTitle ?? ''}`;
  const isTrail = /trail/i.test(searchableText);
  const hasKneeIssue = /knee|kneecap|patell/i.test(searchableText);
  const hasBuddy = /buddy|partner|together/i.test(searchableText);

  let longRunMin = isCouch ? 40 : isCompetitive ? 80 : 60;
  const maxLongRunMin = isCouch ? 180 : isCompetitive ? 200 : 180;

  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(startDate, w * 7);
    const pct = w / weeks;
    let theme: 'base' | 'build' | 'peak' | 'taper' = 'base';
    if (pct > 0.85) theme = 'taper';
    else if (pct > 0.70) theme = 'peak';
    else if (pct > 0.25) theme = 'build';

    const noteCtx = {
      theme, weekNum: w, totalWeeks: weeks,
      isTrail, isCouch, isCompetitive, hasKneeIssue, hasBuddy,
    };

    const weekBlockId = await beads.create({
      title: `week ${w} ${theme} ${weekStart}`,
      labels: [TYPE_WEEK_BLOCK],
      metadata: { planId, weekIndex: w, theme, startDate: weekStart },
    });

    const isLastWeek = w === weeks - 1;

    // Day 0 (Mon-equivalent): Rest
    await beads.create({
      title: `workout ${addDays(weekStart, 0)} rest`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 0),
        kind: 'rest', targetDurationMin: 0, completed: false,
      },
    });

    // Day 1 (Tue): Easy or Intervals
    const tueKind = (!isLastWeek && (theme === 'build' || theme === 'peak') && isCompetitive)
      ? 'intervals' : 'easy';
    const tueMin = tueKind === 'intervals' ? 45 : 30;
    await beads.create({
      title: `workout ${addDays(weekStart, 1)} ${tueKind}`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 1),
        kind: tueKind, targetDurationMin: tueMin, completed: false,
        notes: workoutNotes({ kind: tueKind, durationMin: tueMin, ...noteCtx }),
      },
    });

    // Day 2 (Wed): Strength
    const strengthMin = isCouch ? 35 : (theme === 'peak' || theme === 'taper') ? 35 : 45;
    await beads.create({
      title: `workout ${addDays(weekStart, 2)} strength`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 2),
        kind: 'strength', targetDurationMin: strengthMin, completed: false,
        notes: workoutNotes({ kind: 'strength', durationMin: strengthMin, ...noteCtx }),
      },
    });

    // Day 3 (Thu): Tempo or Easy
    let thuKind: 'easy' | 'tempo' = 'easy';
    let thuMin = isLastWeek ? 30 : 40;
    if (!isLastWeek && (theme === 'build' || theme === 'peak')) {
      thuKind = 'tempo';
      thuMin = 50;
    }
    await beads.create({
      title: `workout ${addDays(weekStart, 3)} ${thuKind}`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 3),
        kind: thuKind, targetDurationMin: thuMin, completed: false,
        notes: workoutNotes({ kind: thuKind, durationMin: thuMin, ...noteCtx }),
      },
    });

    // Day 4 (Fri): Rest
    await beads.create({
      title: `workout ${addDays(weekStart, 4)} rest`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 4),
        kind: 'rest', targetDurationMin: 0, completed: false,
      },
    });

    // Day 5 (Sat): Easy shakeout (shorter in last week)
    const satMin = isLastWeek ? 20 : 30;
    await beads.create({
      title: `workout ${addDays(weekStart, 5)} easy`,
      labels: [TYPE_WORKOUT],
      metadata: {
        weekBlockId, date: addDays(weekStart, 5),
        kind: 'easy', targetDurationMin: satMin, completed: false,
        notes: isLastWeek
          ? "Race-eve shakeout — 15–20 min very easy. Shake out the legs, no effort at all. Lay out your gear tonight."
          : workoutNotes({ kind: 'easy', durationMin: satMin, ...noteCtx }),
      },
    });

    // Day 6 (Sun): Long run or Race day
    let currentLongMin = longRunMin;
    if (theme === 'taper') {
      const taperStart = Math.floor(weeks * 0.85);
      const taperFraction = (w - taperStart) / (weeks - taperStart);
      currentLongMin = Math.round(longRunMin * (1 - taperFraction * 0.55));
    }

    if (isLastWeek) {
      await beads.create({
        title: `workout ${addDays(weekStart, 6)} long`,
        labels: [TYPE_WORKOUT],
        metadata: {
          weekBlockId, date: addDays(weekStart, 6),
          kind: 'long', targetDurationMin: 240, completed: false,
          notes: `RACE DAY — ${planTitle ?? 'Race day'}!\nTrust your training. Start easy — the first miles should feel effortless.\nFuel early and often (every 30–45 min). Walk the steep climbs confidently.\nYou've got this.`,
        },
      });
    } else {
      await beads.create({
        title: `workout ${addDays(weekStart, 6)} long`,
        labels: [TYPE_WORKOUT],
        metadata: {
          weekBlockId, date: addDays(weekStart, 6),
          kind: 'long', targetDurationMin: currentLongMin, completed: false,
          notes: workoutNotes({ kind: 'long', durationMin: currentLongMin, ...noteCtx }),
        },
      });
    }

    // Progress long run for next week (not during taper)
    if (theme === 'base' || theme === 'build' || theme === 'peak') {
      longRunMin = Math.min(maxLongRunMin, longRunMin + 10);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = JSON.parse(process.env.ABACUS_PAYLOAD ?? '{}');
  const beads = new Beads();

  (async () => {
    const plan = await beads.show(payload.planId);
    const meta = plan.metadata as Record<string, unknown>;

    const contexts = await beads.list([TYPE_PLAN_CONTEXT]);
    const ctx = contexts.find((c) => (c.metadata as Record<string, unknown>)?.planId === payload.planId);
    const notes = (ctx?.metadata as Record<string, unknown>)?.notes as string ?? '';

    await generatePlanCore({
      beads,
      planId: payload.planId,
      startDate: meta.startDate as string,
      raceDate: meta.raceDate as string,
      weeks: meta.weeks as number,
      contextNotes: notes,
      ...(meta.templateId ? { templateId: meta.templateId as string } : {}),
      ...(plan.title ? { planTitle: plan.title } : {}),
    });
    console.log(JSON.stringify({ ok: true }));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
