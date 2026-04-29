# Strava Sync Button + Activity Matching

**Date:** 2026-04-29
**Status:** Approved

## Problem

Strava activities that happened while the service was offline accumulate without being matched to planned workouts. There is no user-facing way to pull the latest activities on demand, no record of when the last sync happened, and the `process_activity` agent prompt is placeholder text — so even webhook-delivered activities are never reconciled or used to adapt the plan.

## Goals

1. A sync button that fetches activities from Strava since the last sync.
2. Automatic matching + plan adaptation when a live webhook arrives.
3. The same agent reconciliation runs for manually-confirmed date-based matches.
4. One reconciliation code path for all three entry points.

---

## Section 1: Data Layer & Sync Flow

### `lastSyncedAt` on plan metadata

`lastSyncedAt: string` (ISO 8601) is stored on the existing `marathon:training-plan` Beads metadata — no new entity type. On first sync it defaults to the plan's `startDate`. After each successful sync it is set to the timestamp at the **start** of the sync operation, so if the Strava API is slow there are no gaps in coverage.

### `sync-strava` webhook kind

The dashboard calls `webhookPost('sync-strava', { planId })` — same pattern as `manual-activity`. A new `sync-strava-shim.ts` preScript runs server-side:

1. Reads `lastSyncedAt` from plan metadata (defaults to `startDate`).
2. Calls Strava list endpoint since that timestamp.
3. Dedupes against existing `activityId`s (same Set-based logic as backfill).
4. Creates Beads issues for new activities.
5. Enqueues one `process_activity` task per new activity with `{ activityId }` in the payload.
6. Writes the updated `lastSyncedAt` back to plan metadata.
7. Returns `{ ok: true, newCount: N }`.

`get-state.ts` returns `lastSyncedAt` from plan metadata so the dashboard can display it.

---

## Section 2: `process_activity` Agent Prompt

The task already exists in `abacus.json` with a preScript (`fetch-and-store-strava.ts`) that fetches and stores the full activity. The preScript is idempotent — if the activity already exists it skips the Strava API call. The same task handles all three entry points.

The agent prompt replaces the current placeholder and instructs the agent to:

1. Find the activity in hot memory by `activityId` from the task payload.
2. Find the planned workout whose `date` matches the activity's `start_date_local`. If `workoutId` is present in the payload (manual match), use that directly.
3. Apply CLAUDE.md reconciliation rules to determine `deviationStatus` (duration ±25%, pace ±15% on road, elevation-adjusted for trail).
4. Call `set_workout_actual` with the result.
5. If `deviationStatus` is `partial`, `swapped`, or `skipped` — apply CLAUDE.md adaptation rules: downshift next session, check overtraining thresholds, re-balance the next 7–14 day window.
6. If no planned workout exists on that date (extra activity) — exit silently per CLAUDE.md.

No branching in the prompt for entry point — the agent always reads from hot memory and acts on what it finds.

---

## Section 3: Manual Date-Match → Agent Pipeline

The existing "match by date" UI proposes matches correctly — no changes to that logic. The change is in what happens on confirm.

**Current behavior** (`manual-activity-shim.ts`, `op: reassign`):
- Directly writes `deviationStatus: 'met'` onto the workout.
- Enqueues `daily_reeval`.

**New behavior**:
- Enqueues `process_activity` with `{ activityId, workoutId }` instead of `daily_reeval`.
- The agent finds the workout directly from `workoutId` in the payload — no additional metadata writes needed.
- The agent determines the real `deviationStatus` and applies adaptation.

The `deviationStatus: 'met'` hardcode is removed. The dashboard shows "Queued for matching" after confirm; the workout tile updates on the next state refresh when the agent task completes.

`daily_reeval` continues to fire on its schedule and is not triggered here — `process_activity` covers the adaptation.

---

## Section 4: Dashboard UI

All changes are additive to the existing activities section. No new components.

- **Sync button**: inline in the activities section header. Label: "Sync" → "Syncing…" (disabled) while in-flight. On completion calls `router.refresh()`.
- **Last synced label**: muted text beside the button. "Last synced 3 min ago" if `lastSyncedAt` is set; "Never synced" if not. Computed client-side from the timestamp in state.
- **Manual match confirm**: label stays "Confirm matches". Success state changes from immediate local UI update to "Queued for matching" — the workout tile updates on next state refresh.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/marathon/scripts/sync-strava-shim.ts` | New — sync preScript |
| `packages/marathon/abacus.json` | Add `sync_strava` webhook kind; replace `process_activity` agent prompt |
| `packages/marathon/scripts/manual-activity-shim.ts` | `op: reassign` enqueues `process_activity` instead of writing `met` |
| `packages/marathon/scripts/get-state.ts` | Return `lastSyncedAt` from plan metadata |
| `packages/marathon/dashboard/lib/abacus.ts` | Expose `lastSyncedAt` in state type; add `sync-strava` webhook helper |
| `packages/marathon/dashboard/components/Dashboard.tsx` | Sync button + last-synced label |

## Out of Scope

- Pagination for large activity backlogs (backfill already handles this via timestamp cursor).
- Per-activity sync status in the UI (activities appear on next refresh).
- Retroactive re-matching of already-matched workouts.
