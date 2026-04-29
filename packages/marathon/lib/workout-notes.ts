export interface WorkoutNoteContext {
  kind: 'easy' | 'long' | 'tempo' | 'intervals' | 'rest' | 'cross' | 'strength';
  theme: 'base' | 'build' | 'peak' | 'taper';
  weekNum: number;
  totalWeeks: number;
  durationMin: number;
  isTrail: boolean;
  isCouch: boolean;
  isCompetitive: boolean;
  hasKneeIssue: boolean;
  hasBuddy: boolean;
}

function walkRunInterval(weekNum: number, walkRunWeeks: number): string {
  const pct = walkRunWeeks > 0 ? weekNum / walkRunWeeks : 1;
  if (pct < 0.3) return '1 min run / 2 min walk';
  if (pct < 0.6) return '1 min run / 1 min walk';
  if (pct < 0.85) return '2 min run / 1 min walk';
  return '3 min run / 1 min walk';
}

export function workoutNotes(ctx: WorkoutNoteContext): string | undefined {
  const {
    kind, theme, weekNum, totalWeeks, durationMin,
    isTrail, isCouch, isCompetitive, hasKneeIssue, hasBuddy,
  } = ctx;

  const walkRunWeeks = Math.ceil(totalWeeks * 0.25);
  const isWalkRunPhase = isCouch && weekNum < walkRunWeeks;

  switch (kind) {
    case 'rest':
      return undefined;

    case 'easy': {
      if (isWalkRunPhase) {
        const interval = walkRunInterval(weekNum, walkRunWeeks);
        const lines = [
          `Walk/run intervals (${interval}) for ${durationMin} min total.`,
          "Walk breaks are the training — they let your legs adapt without injury.",
          "Effort: fully conversational throughout. If you can't talk, slow down.",
        ];
        if (isTrail) lines.push("Trail: flat path or road is fine during these early weeks.");
        if (hasKneeIssue) lines.push("Knee: stop if sharp pain. Mild tightness afterward is normal.");
        if (hasBuddy) lines.push("Buddy: adjust intervals to whoever needs more recovery.");
        return lines.join('\n');
      }
      const distLow = Math.max(1, Math.round(durationMin / 14));
      const distHigh = Math.max(distLow + 1, Math.round(durationMin / 11));
      const lines = [
        `Easy run — ${durationMin} min at Zone 2 (conversational pace).`,
        `Estimated distance: ~${distLow}–${distHigh} miles.`,
        "Slow down until you can speak in full sentences — if you can't, you're going too fast.",
      ];
      if (isTrail) lines.push("Trail: hike steep climbs, run flats. HR matters more than pace.");
      if (hasKneeIssue) lines.push("Knee: ease off if you feel discomfort above or behind the kneecap.");
      if (hasBuddy) lines.push("Buddy: match the slower partner's pace. Easy runs are best done together.");
      return lines.join('\n');
    }

    case 'long': {
      const distLow = Math.max(1, Math.round(durationMin / 16));
      const distHigh = Math.max(distLow + 1, Math.round(durationMin / 12));
      const lines = [
        `Long run — ${durationMin} min. Most important session of the week.`,
        `Estimated distance: ~${distLow}–${distHigh} miles at easy trail pace.`,
        "Goal is time on feet, not speed. Start slower than feels necessary.",
      ];
      if (isTrail) lines.push("Trail: hike all real climbs — that's exactly how you'll race Moab.");
      if (durationMin >= 75) {
        lines.push("Fuel: bring water + a gel or snack; take something every 45 min past the first hour.");
      }
      if (theme === 'peak') lines.push("Peak week: this is your highest-volume long run. Extra rest tomorrow.");
      if (hasBuddy) lines.push("Buddy: do this one together. Long runs build your shared race-day strategy.");
      if (hasKneeIssue) lines.push("Knee: walk any section that causes pain. Don't push through on long efforts.");
      return lines.join('\n');
    }

    case 'tempo': {
      const lines = [
        `Tempo run — ${durationMin} min total (includes warm-up + cool-down).`,
        "What's tempo? 'Comfortably hard' — you can say a few words but can't hold a conversation.",
        "HR: Zone 4, ~80–85% of max. Noticeably harder than easy, but sustainable for 20–40 min.",
      ];
      if (isCouch) {
        lines.push("Structure: 10 min easy → 3–4 × 5 min tempo effort → 5–10 min easy cool-down.");
        lines.push("First tempo? Start conservatively. The 3rd rep should be the hardest.");
      } else if (isCompetitive) {
        lines.push("Structure: 10 min easy → 30–40 min at goal marathon pace + 20 sec → 10 min easy.");
      } else {
        lines.push("Structure: 10 min easy warm-up → 20–30 min tempo → 10 min easy cool-down.");
      }
      if (isTrail) lines.push("Trail: push climbs to Zone 4, ease on descents. Use HR, not pace.");
      if (hasKneeIssue) lines.push("Knee: convert to easy run if it hurts during warm-up.");
      return lines.join('\n');
    }

    case 'intervals': {
      const lines: string[] = [];
      if (isCouch) {
        lines.push(
          `Interval run — ${durationMin} min total.`,
          "Structure: 10 min easy → 4–5 × 3 min hard / 3 min easy jog → 5 min easy cool-down.",
          "Hard effort: Zone 4-5. Breathing very hard, can say only 1 word.",
        );
        if (isTrail) lines.push("Trail: use uphills as your hard intervals — push up, easy jog back down.");
        if (hasKneeIssue) lines.push("Knee: swap for an easy run if it's sore going in.");
      } else if (isCompetitive) {
        lines.push(
          `Intervals — ${durationMin} min total.`,
          "Structure: 15 min easy → 5–8 × 1 mile at 10k effort (Zone 5) → 10 min easy.",
          "90 sec recovery jog between reps. First rep should feel controlled — like you could do 2 more.",
          "Stop early if form breaks down.",
        );
        if (isTrail) lines.push("Hill variant: 6–8 × 200–400m uphill at hard effort, easy jog back down.");
      } else {
        lines.push(
          `Intervals — ${durationMin} min total.`,
          "Structure: 10 min easy → 4–6 × 800m at 5k effort → 10 min easy cool-down.",
          "2–3 min recovery jog between reps. Hard but controlled — should feel like you could do one more.",
        );
        if (isTrail) lines.push("Trail: 5–6 × uphill repeats (200–300m climb at hard effort, easy jog back).");
      }
      return lines.join('\n');
    }

    case 'strength': {
      const isLightWeek = theme === 'peak' || theme === 'taper';
      const exercises = isCouch || isLightWeek
        ? [
            "Bodyweight squats: 3×15",
            "Step-downs: 3×12 each leg (stand on a stair, slowly lower your heel toward the floor)",
            "Glute bridges: 3×15",
            "Clamshells: 3×15 each side",
            "Single-leg calf raises: 3×15 each leg",
            "Dead bugs: 3×8 each side",
          ]
        : [
            "Goblet squats: 3×12",
            "Romanian deadlifts: 3×10",
            "Step-downs: 3×12 each leg",
            "Split squats (or reverse lunges): 3×10 each leg",
            "Single-leg calf raises: 3×15 each leg",
            "Glute bridges: 3×15",
            "Dead bugs: 3×10 each side",
          ];
      const lines = [
        `Runner strength — ${durationMin} min. The best injury prevention you can do.`,
      ];
      if (hasKneeIssue) {
        lines.push("Focus: single-leg stability builds the knee strength that prevents your injury from recurring.");
      }
      lines.push('');
      lines.push(...exercises);
      lines.push('');
      lines.push("60–90 sec rest between sets.");
      if (isLightWeek) lines.push("Light week: reduce weight 50%, focus on form over load.");
      if (hasKneeIssue) lines.push("Skip anything causing sharp knee pain.");
      return lines.join('\n');
    }

    case 'cross':
      return [
        `Cross-training — ${durationMin} min at easy Zone 2 effort.`,
        "Options: bike, swim, elliptical, rowing, hiking.",
        "Goal: aerobic maintenance without impact stress on your legs.",
        ...(hasKneeIssue ? ["Knee: biking or swimming are ideal — no joint impact."] : []),
      ].join('\n');
  }
}
