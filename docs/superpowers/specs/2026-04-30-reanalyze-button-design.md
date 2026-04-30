# Design: Re-analyze Button in Marathon Dashboard Header

**Date:** 2026-04-30  
**Status:** Approved

## Summary

Add a "re-analyze" link-style button to the marathon dashboard header that manually triggers a `daily_reeval` agent task, allowing the user to force the system to re-examine the current week and adjust the plan on demand.

## Motivation

The `daily_reeval` task runs automatically on a schedule, but after iterative tweaks to the plan the system can be in an uncertain state. The user wants an explicit way to ask the system to take a fresh pass at the upcoming week without waiting for the next scheduled evaluation.

## Architecture

No backend changes are required. The `daily_reeval` task kind is already registered in `packages/marathon/abacus.json` with a no-op shim (`daily-reeval-shim.ts`). The `invoke()` function in `packages/marathon/dashboard/lib/abacus.ts` already provides the client-side call path to `POST /api/marathon/invoke`.

## UI Change

**File:** `packages/marathon/dashboard/components/Dashboard.tsx`

Add a `re-analyze` button to the existing header link row (`mt-1 flex gap-2` div, currently containing "new plan" and "context" links).

### Visual style

- Default: `text-zinc-400 underline underline-offset-2 hover:text-zinc-100` — matches existing header links exactly
- In-flight: `text-amber-400 cursor-wait` with text "analyzing…" and no underline

### In-flight detection

Derived from the existing `tasks` SSE state — no new React state:

```ts
const isReanalyzing = tasks.some(
  t => t.kind === 'daily_reeval' && (t.phase === 'queued' || t.phase === 'started')
);
```

### Click handler

```ts
async function onReanalyze() {
  await invoke('daily_reeval', {}, `daily_reeval:${state.todayIso}`);
}
```

The date-bucketed `dedupeKey` (`daily_reeval:YYYY-MM-DD`) prevents double-queuing if clicked multiple times in the same day. The SSE `TASK_COMPLETE` event already triggers `refresh()`, so the plan view updates automatically when the agent finishes.

## Data flow

1. User clicks "re-analyze"
2. `invoke('daily_reeval', {}, dedupeKey)` → `POST /api/marathon/invoke`
3. Platform enqueues task, publishes `TASK_QUEUED` SSE event
4. Dashboard SSE listener picks up `TASK_QUEUED` → `isReanalyzing` becomes true → button shows "analyzing…"
5. Agent runs `daily_reeval`, makes plan adjustments via MCP tools
6. Platform publishes `TASK_COMPLETE` SSE event
7. Dashboard SSE listener calls `refresh()` → plan view updates

## Out of scope

- No new API endpoints
- No new shim scripts
- No changes to `abacus.json` or platform code
- No deduplication UI beyond the disabled/text state
