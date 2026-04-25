# Plan Templates

These are agent-readable markdown files consumed exclusively by Claude during plan generation. They describe how to structure a training plan — periodization, weekly shape, intensity progression — not literal week-by-week schedules. Templates are guidance, not constraints; agents adapt them freely based on plan-context.

**Templates are never read by orchestrator code.** Only agent sessions (Claude Code runs spawned by the platform) read these files.

---

## When to choose each template

**`couch-to-marathon.md`** — For users with no consistent running base in the last 90 days. Signals: "starting from scratch," "first marathon," fewer than ~10 Strava running activities in the prior 90 days, or weekly totals under ~10 km. Requires 24–32 weeks for ideal results; use `base-builder` instead if fewer than 18 weeks remain before race day.

**`base-builder.md`** — For users with an existing running base of 15–25 km/week who want to complete their first (or second) marathon without a time goal. Signals: recent half-marathon finish, "getting back into it," 20–40 Strava running activities in the prior 90 days. Works best at 18–24 weeks; flag as compressed if fewer than 14 weeks remain.

**`competitive.md`** — For experienced runners targeting a specific finish time. Signals: explicit goal time, prior marathon or multiple half-marathon finishes within 18 months, current volume 40+ km/week, structured workouts already visible in Strava. Typical 16–20 weeks; flag as too short if fewer than 16 weeks remain and do not compress taper or peak to fit.

---

## How the agent uses these files

Read all three templates, pick the closest fit based on plan-context and backfilled Strava data, then adapt freely — templates are guidance, not constraints. The chosen template sets the phase boundaries, session count, long-run ceiling, and quality-session timing. Everything else (exact paces, workout notes, cross-training substitutions, injury accommodations) comes from plan-context and agent judgment.

---

## How to add a new template

Drop a new `.md` file in this directory following the same five-section structure:

1. **When to choose this template** — observable signals from plan-context and Strava that point to this template.
2. **Structural rules** — total weeks, sessions per week, phase boundaries, long-run day.
3. **Workout shape rules** — pace guidance, duration caps, long-run ceiling, strength session shape.
4. **Adaptation guardrails** — volume limits, injury substitutions, taper rules, partner handling.
5. **Race week** — the fixed day-by-day race-week schedule.

No platform-side configuration changes are needed. The agent discovers templates by reading this directory.
