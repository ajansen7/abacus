# ADR-0003: `marathon:race` entity and `workout.actual` sub-object

**Date:** 2026-04-25
**Status:** Accepted

## Context

The original Marathon product used a single `marathon:training-plan` entity that stored `raceDate` and `goalPace` as flat metadata fields — enough to drive the MVP (seed a plan, react to RPE). The user now wants to use this as their actual training tool for a specific race (Moab Marathon, November 2026) and needs the app to:

1. Accept a race as explicit input (name, date, distance, location, optional goal finish time).
2. Record what was *actually done* for each planned workout — a different activity kind, a shortened run, a skipped session — not just whether it was `completed: true`.
3. Distinguish the source of an activity (Strava vs. manual) and the nature of its deviation from the plan.

## Decision 1: `marathon:race` as a first-class entity

**Chosen:** A dedicated `marathon:race` Beads issue, referenced by `raceId` on the training-plan.

**Alternatives considered:**
- Keep `raceDate`/`goalPace` flat on `marathon:training-plan`. Rejected: no place for richer race metadata (distance, location, goalFinishTime) without polluting the plan entity; future multi-race (A-race + B-race) support would require a messy array-of-structs in one metadata blob.
- Promote to a platform-level concept. Rejected: hard platform/product boundary — the platform knows nothing about races, distances, or finish times.

**Consequences:** `marathon:training-plan.raceId` is now optional (old seed-plan paths that don't create a race entity continue to work). `get-state.ts` looks up the race by `raceId` and includes it in the state payload. Dashboard shows race name and countdown.

## Decision 2: `actual` as a sub-object on `marathon:workout`

**Chosen:** An optional `actual: WorkoutActual` sub-object on the existing `marathon:workout` entity.

```ts
WorkoutActual = {
  activityId?: string;       // Beads issue ID of the strava-activity
  activityKind: ActualActivityKind;  // run | bike | swim | hike | strength | mobility | other
  source: 'strava' | 'manual';
  deviationStatus: 'met' | 'partial' | 'swapped' | 'skipped' | 'extra';
  durationMin?: number;
  notes?: string;
}
```

**Alternatives considered:**
- Separate `marathon:workout-result` entity. Rejected: every query that needs to show "planned vs. actual" would require a join; the one-result-per-workout invariant is easier to enforce with an inline sub-object; the entity count would double with no query benefit at current scale.
- Mutate existing `completed: boolean` only. Rejected: completely loses deviation type, actual duration, and source — all of which the reconciliation agent and dashboard need.

**Consequences:**
- `WorkoutActual` is set by the `set_workout_actual` MCP tool, which is the only sanctioned write path for the `actual` sub-object.
- `completed` stays as a separate field (set by `markCompleted` param on `set_workout_actual`). The agent keeps setting it; nothing regresses.
- `WorkoutPatch` also accepts `actual` so the existing `update_workout` tool can clear it when needed.

## Decision 3: `deviationStatus` as a closed enum

**Chosen:** Five values: `met | partial | swapped | skipped | extra`.

**Rationale:** A closed enum means:
- Agent prompt rules are unambiguous ("if deviationStatus is `swapped`, do X").
- Dashboard badge rendering is deterministic.
- Future audit queries can group by deviation type without free-text parsing.

`extra` covers the "activity on a rest day" and "unmatched activity" cases — both indicate the athlete did something not in the plan, but the plan itself is not violated.

## Consequences (cross-cutting)

- `backfill_strava` is idempotent: it checks existing `marathon:strava-activity` issues by `activityId` before writing. Re-running never duplicates.
- Manual add/delete/reassign go through `manual-activity-shim.ts` → webhook → `process_activity` agent, preserving ZFC: the shim does IO only, the agent decides what `deviationStatus` applies.
- `get-state.ts` exposes both `recentActivities` (existing 10-item slice, backward-compatible) and `allActivities` (full list with `source` field) so the dashboard can show the complete activity log.
