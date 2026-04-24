#!/usr/bin/env tsx
/**
 * Seed a marathon training plan in Beads. Deterministic — given the same flags,
 * it lays down a fixed structure: 1 plan + N week-blocks + 7N workouts. No AI;
 * any judgement (workout selection, periodization details) lives in the agent
 * via `claude.md` heuristics. This script just creates the skeleton.
 *
 * Usage:
 *   tsx scripts/seed-plan.ts --weeks 4 --goal-pace 5:00 --race 2026-06-14 [--start 2026-05-17]
 */
import { Beads } from '@abacus/platform';
import {
  TYPE_TRAINING_PLAN,
  TYPE_WEEK_BLOCK,
  TYPE_WORKOUT,
  TrainingPlanMeta,
  WeekBlockMeta,
  WeekTheme,
  WorkoutKind,
  WorkoutMeta,
} from '../lib/types.js';

interface CliFlags {
  weeks: number;
  goalPace: string;
  race: string;
  start?: string;
}

function parseFlags(argv: string[]): CliFlags {
  const out: Partial<CliFlags> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith('--')) continue;
    if (value === undefined) throw new Error(`seed-plan: ${flag} requires a value`);
    switch (flag) {
      case '--weeks':
        out.weeks = Number.parseInt(value, 10);
        i += 1;
        break;
      case '--goal-pace':
        out.goalPace = value;
        i += 1;
        break;
      case '--race':
        out.race = value;
        i += 1;
        break;
      case '--start':
        out.start = value;
        i += 1;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!out.weeks || !out.goalPace || !out.race) {
    throw new Error('seed-plan: --weeks, --goal-pace, and --race are required');
  }
  return out as CliFlags;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function themeForWeek(weekIndex: number, totalWeeks: number): WeekTheme {
  const remaining = totalWeeks - weekIndex - 1;
  if (remaining <= 1) return 'taper';
  if (remaining <= 3) return 'peak';
  if (weekIndex < Math.max(1, Math.floor(totalWeeks * 0.25))) return 'base';
  return 'build';
}

function workoutTemplate(theme: WeekTheme, dayIndex: number): {
  kind: WorkoutKind;
  durationMin: number;
} {
  const week: { kind: WorkoutKind; durationMin: number }[] = [
    { kind: 'easy', durationMin: 45 },
    { kind: 'tempo', durationMin: 50 },
    { kind: 'rest', durationMin: 0 },
    { kind: 'intervals', durationMin: 55 },
    { kind: 'easy', durationMin: 40 },
    { kind: 'long', durationMin: 90 },
    { kind: 'rest', durationMin: 0 },
  ];
  const base = week[dayIndex] ?? { kind: 'easy', durationMin: 30 };
  const themeMultiplier =
    theme === 'taper' ? 0.6 : theme === 'peak' ? 1.2 : theme === 'build' ? 1.0 : 0.85;
  return {
    kind: base.kind,
    durationMin: Math.max(0, Math.round(base.durationMin * themeMultiplier)),
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const raceDate = new Date(`${flags.race}T00:00:00Z`);
  if (Number.isNaN(raceDate.getTime())) throw new Error(`invalid --race: ${flags.race}`);

  const totalDays = flags.weeks * 7;
  const startDate = flags.start
    ? new Date(`${flags.start}T00:00:00Z`)
    : addDays(raceDate, -totalDays + 1);

  const beads = new Beads();
  const planMeta = TrainingPlanMeta.parse({
    raceDate: flags.race,
    goalPace: flags.goalPace,
    startDate: isoDate(startDate),
    weeks: flags.weeks,
  });
  const planId = await beads.create({
    title: `Training plan — race ${flags.race} @ ${flags.goalPace}/km`,
    labels: [TYPE_TRAINING_PLAN, 'product:marathon'],
    metadata: planMeta,
  });
  console.log(`[seed-plan] plan ${planId}`);

  for (let w = 0; w < flags.weeks; w += 1) {
    const weekStart = addDays(startDate, w * 7);
    const theme = themeForWeek(w, flags.weeks);
    const weekMeta = WeekBlockMeta.parse({
      planId,
      weekIndex: w,
      theme,
      startDate: isoDate(weekStart),
    });
    const weekId = await beads.create({
      title: `Week ${w + 1}/${flags.weeks} — ${theme}`,
      labels: [TYPE_WEEK_BLOCK, 'product:marathon'],
      metadata: weekMeta,
    });

    for (let d = 0; d < 7; d += 1) {
      const tpl = workoutTemplate(theme, d);
      const workoutMeta = WorkoutMeta.parse({
        weekBlockId: weekId,
        date: isoDate(addDays(weekStart, d)),
        kind: tpl.kind,
        targetDurationMin: Math.max(1, tpl.durationMin),
        targetPace: tpl.kind === 'rest' ? undefined : flags.goalPace,
        completed: false,
      });
      await beads.create({
        title: `Week ${w + 1} day ${d + 1} — ${tpl.kind}`,
        labels: [TYPE_WORKOUT, 'product:marathon'],
        metadata: workoutMeta,
      });
    }
    console.log(`[seed-plan] week ${w + 1} (${theme}) seeded`);
  }
  console.log(`[seed-plan] OK — ${flags.weeks} week(s), ${flags.weeks * 7} workouts`);
}

main().catch((err) => {
  console.error('[seed-plan] fatal', err);
  process.exit(1);
});
