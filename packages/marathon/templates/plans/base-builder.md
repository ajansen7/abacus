# Template: Base Builder

## When to choose this template

Pick this template when the user has a recent running base of roughly 15–25 km/week and has completed a few shorter races or run consistently for at least one training cycle. Strong signals from plan-context: phrases like "getting back into it," "ran a half marathon a while ago," "semi-consistent," or "first full marathon but I've been running." Strong signals from backfilled Strava: 20–40 running activities in the 90 days before `startDate`, totaling 15–25 km/week on average.

## Structural rules

- Total weeks: 18–24 ideal. If `weeks < 14`, flag in plan-context notes as too compressed; consider shifting the goal race or picking a shorter-distance event. If `weeks > 24`, add extra base-building weeks at the front before the quality block starts.
- Sessions per week: 4–5 (3–4 runs + 1 strength).
- Long run on Sunday by default; honor plan-context availability constraints.
- Phases: weeks 0–25% build aerobic base (easy runs only, no quality work). Weeks 25–70% introduce one quality session per week starting in week 5 — alternate tempo and interval blocks every 3 weeks. Weeks 70–85% are peak weeks with max long-run volume. Final 15% (minimum 3 weeks) is taper.

## Workout shape rules

- Easy runs at conversational pace — the runner should be able to speak full sentences throughout. Cap at 70% of long-run duration.
- Tempo sessions at "comfortably hard" — sustainable for 20–40 min; roughly 80–85% max HR. Duration builds from 20 min up to 40 min over the quality block.
- Interval sessions are 4–6 × 800 m or 4 × 1 km at 5 km race effort with full recovery jogs. Introduce no earlier than week 5.
- Long run grows by no more than 10 min (or ~1.5 km) per week; maximum 32–34 km for this template.
- Strength is one session per week, 40–50 min, moderate load. Include single-leg stability work (step-downs, split squats) when knee injury appears in plan-context.
- One full rest day per week, always the day after the long run.

## Adaptation guardrails

- Never increase weekly volume by more than 10% week-over-week.
- Do not schedule two quality sessions in the same week until the runner has completed at least 6 weeks in the plan without flagged overtraining events.
- During taper (last 3 weeks), reduce volume by ~20% each week; keep one quality session in week 1 of taper but drop it in weeks 2–3.
- If plan-context names an injury, substitute the nearest easy run with `cross` before touching quality sessions. Never convert a tempo to intervals as a substitution.
- If plan-context names a training partner with lower fitness, protect the long run (keep it joint) and move quality sessions to solo days.

## Race week

- Mon: 30 min easy. Tue: rest. Wed: 35 min easy with 5×30 sec strides. Thu: rest. Fri: 20 min very easy. Sat: rest or 15 min shake-out. Sun: race.
