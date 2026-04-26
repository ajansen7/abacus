# Template: Competitive

## When to choose this template

Pick this template when the user is targeting a specific finish time and has race history to anchor goal pace. Strong signals from plan-context: explicit goal time ("sub-3:30," "BQ attempt"), prior marathon or multiple half-marathon finishes within the last 18 months, and current weekly volume of 25+ miles. Strong signals from backfilled Strava: structured workouts already present (intervals, tempo), long runs reaching 15+ miles, and ≥ 50 running activities in the 90 days before `startDate`. If `weeks < 16`, flag in plan-context notes as too short for this template and consider shifting the goal race — do not compress the taper or peak block to fit.

## Structural rules

- Total weeks: 16–20 typical. If `weeks > 20`, add base-building weeks at the front; do not extend the peak or taper blocks.
- Sessions per week: 5–6 (4–5 runs + 1 strength).
- Long run on Sunday by default; honor plan-context availability constraints.
- Phases: weeks 0–15% are transition/base (easy volume only). Weeks 15–75% are the build block — two quality sessions per week starting week 3 (tempo mid-week, intervals or goal-pace work on a second mid-week day). Weeks 75–85% are peak weeks (maximum long run volume, race-specific workouts). Final 15% (minimum 3 weeks) is taper.

## Workout shape rules

- Easy runs at a truly easy pace (could hold a phone call); cap at 65% of long-run duration. For trail runs, focus on HR Zone 1-2 and ignore pace; incorporate `targetElevationGain` if course demands it.
- Tempo runs at goal-marathon pace +15–25 sec/mile — sustainable for 30–50 min. Build from 30 min to 50 min over the build block.
- Interval sessions: 5–8 × 1 mile at 10k race effort, or 4 × 1.2 mile at half-marathon effort, with 90 sec recovery. Introduce goal-pace miles (2–3 × 2 miles at exact goal marathon pace) in the peak block. For trail plans, swap one interval session every two weeks with hill repeats.
- Long run grows by no more than 10–15 min per week; peak runs reach 22–24 miles. Two designated long runs in the peak block are fueling-practice runs — note this in workout metadata (`notes: "fuel practice — test race-day nutrition strategy"`). These runs simulate race-day fueling cadence (every 30–45 min) and should be run at goal marathon pace for at least the final 25%. For trail races, long runs should specify `targetElevationGain` matching the race profile.
- Strength is one session per week, 45–60 min, moderate-to-heavy load. Emphasize posterior chain and hip stability. Reduce load in peak and taper weeks; cut to 30 min bodyweight-only during the last 2 weeks.
- One full rest day per week, always the day after the long run.

## Adaptation guardrails

- Never increase weekly volume by more than 10% week-over-week, even for experienced athletes.
- Two quality sessions per week is a ceiling — if an overtraining flag fires, drop the secondary quality session (intervals) before touching the primary (tempo).
- During taper (last 3 weeks): week 1 keeps one quality session at reduced volume; weeks 2–3 convert all quality to easy or strides. Absolutely no new intensity in the final 10 days.
- If plan-context names an injury, protect quality sessions over easy runs — convert easy runs to `cross` first. Flag to re-evaluate template choice if the injury affects more than two consecutive weeks.
- Never schedule goal-pace work in the same week as a fueling-practice long run.

## Race week

- Mon: 40 min easy. Tue: rest. Wed: 40 min easy with 6×20 sec strides at goal pace. Thu: rest. Fri: 25 min very easy. Sat: rest or 15 min shake-out. Sun: race.
