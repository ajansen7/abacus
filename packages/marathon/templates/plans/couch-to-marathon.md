# Template: Couch to Marathon

## When to choose this template

Pick this template when the user has no consistent running base in the last 90 days. Strong signals from plan-context: phrases like "starting from scratch," "couch to marathon," "haven't been running," or "first marathon." Strong signals from backfilled Strava: fewer than ~10 running activities in the 90 days before the plan's `startDate`, or running totals under ~6 miles/week.

## Structural rules

- Total weeks: 24–32 ideal. If `weeks < 18`, this template is the wrong fit; flag in plan-context notes and pick `base-builder` instead, even if context says "couch to marathon."
- Sessions per week: 4 (3 runs + 1 strength).
- Long run is on Sunday by default; honor partner-availability constraints in plan-context.
- Phases: weeks 0–25% are walk-heavy run/walk intervals. Weeks 25–60% are continuous easy running, building duration. Weeks 60–85% adds one tempo-lite session per week (no intervals at this intensity level). Final 15% is taper.

## Workout shape rules

- Easy runs cap at 70% of long-run duration.
- No track or interval sessions for the first 12 weeks. Introduce 1-mile tempo intervals only after the user comfortably completes a 12-mile long run.
- Long run duration grows by no more than 10% per week, and never by more than 10 minutes at a time. The longest run peaks at 20 miles.
- Strength is one session per week, 30–45 min, low impact (lower-body emphasis but not plyometrics) when knee injury is in plan-context.
- One full rest day per week, always the day after the long run.
- Cross-training (`cross`) is optional substitute for one easy run if plan-context mentions a non-running discipline.

## Adaptation guardrails

- Never increase weekly volume by more than 10% week-over-week.
- During taper (last 3 weeks), no intensity or duration increases — only back-offs.
- If plan-context names an injury, bias affected workouts toward `cross` substitution (e.g., bike for an easy run if the knee flares).
- If plan-context names a training partner with a different fitness level, plan to the slower runner's needs and let the stronger runner add a separate session out of band.

## Race week

- Mon: 30 min easy. Tue: rest. Wed: 30 min easy with 4×30 sec strides. Thu: rest. Fri: 20 min very easy. Sat: rest or 15 min shake-out. Sun: race.
