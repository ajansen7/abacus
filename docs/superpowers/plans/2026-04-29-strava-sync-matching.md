# Strava Sync + Activity Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sync button to pull latest Strava activities, wire automatic agent reconciliation for live webhooks, and route manual date-matches through the same agent pipeline so the plan adapts after every activity regardless of how it entered.

**Architecture:** A new `sync-strava` webhook shim runs backfill since `lastSyncedAt` (stored on plan metadata), enqueues one `process_activity` task per new activity, then updates the timestamp. The `process_activity` agent prompt is updated to handle all three entry points (webhook, sync, manual reassign) using `activityIssueId`/`workoutId` fields in the payload. Manual reassign no longer hardcodes `deviationStatus: 'met'` — it enqueues `process_activity` instead, so the agent assesses deviation and adapts future workouts.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest, Beads/Dolt, Fastify webhook shim pattern, Next.js App Router dashboard.

---

## File Map

| File | Change |
|------|--------|
| `packages/marathon/scripts/backfill-strava.ts` | Extend `backfillCore` to return `createdIds: string[]` |
| `packages/marathon/tests/backfill-strava.test.ts` | Add assertion for `createdIds` |
| `packages/marathon/scripts/sync-strava-shim.ts` | **New** — sync webhook shim |
| `packages/marathon/tests/sync-strava-shim.test.ts` | **New** — shim unit tests |
| `packages/marathon/abacus.json` | Add `sync-strava` webhook entry; update `process_activity` prompt |
| `packages/marathon/scripts/fetch-and-store-strava.ts` | Add `activityIssueId` to preScript skip check |
| `packages/marathon/scripts/manual-activity-shim.ts` | `op: reassign` enqueues `process_activity` instead of hardcoding `met` |
| `packages/marathon/tests/manual-activity-shim.test.ts` | Update reassign test expectations |
| `packages/marathon/dashboard/lib/abacus.ts` | Add `lastSyncedAt?: string` to `Plan` interface |
| `packages/marathon/dashboard/components/Dashboard.tsx` | Sync button + last-synced label |

---

## Task 1: Extend `backfillCore` to return created IDs

`backfillCore` currently returns `{ created, total }`. The sync shim needs the Beads issue IDs of newly-created activities so it can enqueue `process_activity` for each.

**Files:**
- Modify: `packages/marathon/scripts/backfill-strava.ts`
- Modify: `packages/marathon/tests/backfill-strava.test.ts`

- [ ] **Step 1: Update the return type and collect IDs**

In `backfill-strava.ts`, replace the `created` counter with an array:

```typescript
export async function backfillCore({ beads, strava, sinceUnix, beforeUnix }: BackfillDeps) {
  const existing = await beads.list([TYPE_STRAVA_ACTIVITY]);
  const seen = new Set<number>(
    existing
      .map((i: any) => Number(i.metadata?.activityId))
      .filter((n: number) => Number.isFinite(n)),
  );
  const activities = await strava.listActivities(
    beforeUnix !== undefined
      ? { afterUnix: sinceUnix, beforeUnix }
      : { afterUnix: sinceUnix },
  );
  const createdIds: string[] = [];
  for (const activity of activities as any[]) {
    if (seen.has(activity.id)) continue;
    const id = await beads.create({
      title: `strava ${activity.id} ${activity.type} ${activity.start_date}`,
      labels: [TYPE_STRAVA_ACTIVITY],
      metadata: {
        activityId: activity.id,
        aspectType: 'create',
        ownerId: activity.athlete?.id ?? 0,
        subscriptionId: 0,
        eventTimeUnix: Math.floor(new Date(activity.start_date).getTime() / 1000),
        fetchedAt: new Date().toISOString(),
        offline: true,
        activity,
      },
    });
    seen.add(activity.id);
    createdIds.push(id);
  }
  return { created: createdIds.length, createdIds, total: (activities as any[]).length };
}
```

Also update the CLI entrypoint at the bottom — `backfillCore(...).then((r) => { console.log(JSON.stringify({ ok: true, ...r })); })` — `createdIds` will now appear in the JSON output but that's harmless.

- [ ] **Step 2: Add `createdIds` assertion to the existing test**

In `tests/backfill-strava.test.ts`, add to the "writes one issue per activity on first run" test:

```typescript
const result = await backfillCore({ beads: beadsLike as any, strava: stravaLike as any, sinceUnix: 0 });
expect(created).toHaveLength(3);
expect(result.createdIds).toHaveLength(3);
expect(result.createdIds[0]).toBe('sa-1');
```

And to "does not duplicate on second run":

```typescript
const result = await backfillCore({ beads: beadsLike as any, strava: stravaLike as any, sinceUnix: 0 });
expect(created).toHaveLength(1);
expect(result.createdIds).toHaveLength(1);
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @abacus-products/marathon test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/marathon/scripts/backfill-strava.ts packages/marathon/tests/backfill-strava.test.ts
git commit -m "feat(marathon): return createdIds from backfillCore"
```

---

## Task 2: Create `sync-strava-shim.ts`

The shim follows the same pattern as `manual-activity-shim.ts`: reads `ABACUS_HTTP_BODY`, does work, writes a JSON action to stdout.

**Files:**
- Create: `packages/marathon/scripts/sync-strava-shim.ts`
- Create: `packages/marathon/tests/sync-strava-shim.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/marathon/tests/sync-strava-shim.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { syncStravaCore } from '../scripts/sync-strava-shim.js';

const sampleActivity = (id: number, startDate = '2026-04-28T07:00:00Z') => ({
  id,
  type: 'Run',
  start_date: startDate,
  start_date_local: startDate.replace('Z', ''),
  distance: 5000,
  moving_time: 1800,
  athlete: { id: 99 },
});

function makeBeads(planMeta: Record<string, unknown> = {}) {
  const issues: any[] = [
    {
      id: 'plan-1',
      labels: ['marathon:training-plan'],
      status: 'open',
      metadata: { startDate: '2026-04-01', ...planMeta },
    },
  ];
  return {
    issues,
    list: async (labels: string[]) =>
      issues.filter((i) => labels.every((l) => (i.labels as string[]).includes(l))),
    create: async (issue: any) => {
      const id = `sa-${issues.length + 1}`;
      issues.push({ id, ...issue });
      return id;
    },
    show: async (id: string) => {
      const found = issues.find((i) => i.id === id);
      if (!found) throw new Error(`not found: ${id}`);
      return found;
    },
    updateMetadata: async (id: string, patch: any) => {
      const i = issues.find((x) => x.id === id);
      if (!i) throw new Error(`not found: ${id}`);
      i.metadata = { ...i.metadata, ...patch };
    },
  };
}

function makeQueue() {
  const enqueued: any[] = [];
  return {
    enqueued,
    enqueue: async (req: any) => {
      enqueued.push(req);
      return { task: { id: `t-${enqueued.length}` } };
    },
  };
}

describe('syncStravaCore', () => {
  it('stores new activities and enqueues process_activity for each', async () => {
    const beads = makeBeads();
    const queue = makeQueue();
    const strava = { listActivities: async () => [sampleActivity(1), sampleActivity(2)] };

    const result = await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
      nowIso: '2026-04-29T10:00:00.000Z',
    });

    expect(result.newCount).toBe(2);
    expect(queue.enqueued).toHaveLength(2);
    expect(queue.enqueued[0].kind).toBe('process_activity');
    expect(queue.enqueued[0].payload.activityIssueId).toMatch(/^sa-/);
    expect(queue.enqueued[0].payload).not.toHaveProperty('workoutId');
  });

  it('updates lastSyncedAt on plan metadata', async () => {
    const beads = makeBeads();
    const queue = makeQueue();
    const strava = { listActivities: async () => [sampleActivity(3)] };

    await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
      nowIso: '2026-04-29T10:00:00.000Z',
    });

    const plan = beads.issues.find((i: any) => i.id === 'plan-1');
    expect(plan.metadata.lastSyncedAt).toBe('2026-04-29T10:00:00.000Z');
  });

  it('defaults sinceUnix to plan startDate when lastSyncedAt is absent', async () => {
    let capturedArgs: any;
    const beads = makeBeads(); // no lastSyncedAt in planMeta
    const queue = makeQueue();
    const strava = {
      listActivities: async (args: any) => {
        capturedArgs = args;
        return [];
      },
    };

    await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
    });

    // startDate is 2026-04-01, so sinceUnix should equal that date
    const expected = Math.floor(new Date('2026-04-01T00:00:00Z').getTime() / 1000);
    expect(capturedArgs.afterUnix).toBe(expected);
  });

  it('skips already-stored activities (deduplication)', async () => {
    // Pre-populate with activity id=1 already in beads
    const beads = makeBeads();
    beads.issues.push({
      id: 'sa-existing',
      labels: ['marathon:strava-activity'],
      metadata: { activityId: 1 },
    });
    const queue = makeQueue();
    const strava = { listActivities: async () => [sampleActivity(1), sampleActivity(2)] };

    const result = await syncStravaCore({
      beads: beads as any,
      queue: queue as any,
      strava: strava as any,
      planId: 'plan-1',
    });

    expect(result.newCount).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @abacus-products/marathon test tests/sync-strava-shim.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sync-strava-shim.ts`**

Create `packages/marathon/scripts/sync-strava-shim.ts`:

```typescript
#!/usr/bin/env tsx
import { z } from 'zod';
import { Beads, Queue } from '@abacus/platform';
import { createStravaClient, type StravaClient } from '../lib/strava-client.js';
import { backfillCore } from './backfill-strava.js';
import { TYPE_STRAVA_ACTIVITY, TYPE_TRAINING_PLAN } from '../lib/types.js';

type Action =
  | { kind: 'respond'; status: number; body: string; contentType?: string }
  | { kind: 'reject'; status: number; reason: string };

function respond(action: Action): void {
  process.stdout.write(JSON.stringify(action) + '\n');
}

const SyncPayload = z.object({ planId: z.string().min(1) });

interface SyncDeps {
  beads: {
    list: (labels: string[]) => Promise<any[]>;
    create: (issue: any) => Promise<string>;
    show: (id: string) => Promise<any>;
    updateMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>;
  };
  queue: { enqueue: (req: any) => Promise<{ task: { id: string } }> };
  strava: Pick<StravaClient, 'listActivities'>;
  planId: string;
  nowIso?: string;
}

export async function syncStravaCore({ beads, queue, strava, planId, nowIso }: SyncDeps) {
  const plan = await beads.show(planId);
  const meta = (plan.metadata ?? {}) as Record<string, unknown>;
  const startDate = meta.startDate as string;
  const lastSyncedAt = (meta.lastSyncedAt as string | undefined) ?? `${startDate}T00:00:00Z`;
  const syncStart = nowIso ?? new Date().toISOString();

  const sinceUnix = Math.floor(new Date(lastSyncedAt).getTime() / 1000);
  const { createdIds } = await backfillCore({ beads, strava, sinceUnix });

  for (const activityIssueId of createdIds) {
    await queue.enqueue({
      product: 'marathon',
      kind: 'process_activity',
      payload: { activityIssueId },
      dedupeKey: `sync-activity:${activityIssueId}`,
    });
  }

  await beads.updateMetadata(planId, { lastSyncedAt: syncStart });

  return { newCount: createdIds.length };
}

async function main(): Promise<void> {
  const body = process.env.ABACUS_HTTP_BODY ?? '';
  if (!body) {
    respond({ kind: 'reject', status: 400, reason: 'empty body' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    respond({ kind: 'reject', status: 400, reason: 'invalid json' });
    return;
  }
  const result = SyncPayload.safeParse(parsed);
  if (!result.success) {
    respond({ kind: 'reject', status: 400, reason: result.error.message });
    return;
  }

  const beads = new Beads();
  const realQueue = new Queue(beads, 3600);
  const queue = {
    enqueue: async (req: any) => {
      const r = await realQueue.enqueue(req);
      return { task: { id: r.task.id } };
    },
  };
  const strava = createStravaClient({
    clientId: process.env.STRAVA_CLIENT_ID!,
    clientSecret: process.env.STRAVA_CLIENT_SECRET!,
    refreshToken: process.env.STRAVA_REFRESH_TOKEN!,
  });

  try {
    const out = await syncStravaCore({ beads: beads as any, queue, strava, planId: result.data.planId });
    respond({ kind: 'respond', status: 200, body: JSON.stringify({ ok: true, ...out }) });
  } catch (err) {
    respond({ kind: 'reject', status: 500, reason: String((err as Error).message ?? err) });
  }
}

main().catch((err) => {
  respond({ kind: 'reject', status: 500, reason: String(err) });
  process.exit(1);
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @abacus-products/marathon test tests/sync-strava-shim.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
pnpm --filter @abacus-products/marathon test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/marathon/scripts/sync-strava-shim.ts packages/marathon/tests/sync-strava-shim.test.ts
git commit -m "feat(marathon): add sync-strava-shim with lastSyncedAt tracking"
```

---

## Task 3: Register `sync-strava` webhook and update `process_activity` prompt

**Files:**
- Modify: `packages/marathon/abacus.json`
- Modify: `packages/marathon/scripts/fetch-and-store-strava.ts`

- [ ] **Step 1: Add `sync-strava` webhook to `abacus.json`**

In `packages/marathon/abacus.json`, add to the `webhooks` object (after `"coach-message"`):

```json
"sync-strava": {
  "preScript": "[ -f dist/scripts/sync-strava-shim.js ] && node dist/scripts/sync-strava-shim.js || tsx scripts/sync-strava-shim.ts"
}
```

- [ ] **Step 2: Update `process_activity` prompt in `abacus.json`**

Replace the existing `process_activity` prompt string with:

```
A `marathon:strava-activity` Beads issue is ready for reconciliation. Task ID: {{taskId}}. Payload: {{payloadJson}}.\n\nHot memory snapshot (open plan, week-blocks, workouts, plan-context, effort logs, recent activities):\n{{hotMemoryJson}}\n\nYour job, in order:\n\n1. **Find the activity.** If `activityIssueId` is present in the task payload, find the `marathon:strava-activity` in hot memory with that Beads issue ID. Otherwise find the most recently added `marathon:strava-activity` in hot memory.\n\n2. **Find the workout.** If `workoutId` is present in the task payload, use that workout directly. Otherwise find the planned workout whose `date` matches the activity's `start_date_local` (YYYY-MM-DD). If zero workouts match on that date: this is an extra activity — do not patch any workout, exit silently. If multiple workouts match on the same day: pick the one whose `kind` maps closest to the activity's mapped kind.\n\n3. **Reconcile.** Call `set_workout_actual({workoutId, actual: {activityId, activityKind, source, deviationStatus, durationMin}})` where:\n   - `activityId` = the Beads issue ID of the activity\n   - `activityKind` = map sport_type per the rules in claude.md (run/bike/swim/hike/strength/mobility/other)\n   - `source` = \"strava\" (or \"manual\" if the activity metadata has `source: \"manual\"`)\n   - `deviationStatus` = follow the reconciliation rules in claude.md (duration ±25%, pace ±15% on road, elevation-adjusted for trail, strength→strength = met, etc.)\n   - `durationMin` = `moving_time / 60` rounded to nearest integer\n\n4. **Adapt** (only if deviationStatus is `partial`, `swapped`, or `skipped`, or effort heuristics from claude.md apply). Call `update_workout` on workouts within the next 14 days to re-balance load. Do NOT touch workouts beyond day+14. Do NOT increase volume in taper weeks.\n\n5. **Flag.** If overreach heuristics from claude.md apply, call `flag_overtraining`.\n\nUse `query_history` only if hot memory lacks data you need. Exit silently if no action beyond step 3 is warranted.
```

- [ ] **Step 3: Update `fetch-and-store-strava.ts` preScript skip check**

In `packages/marathon/scripts/fetch-and-store-strava.ts`, find the skip check block:

```typescript
// Manual reassign / reconcile payloads already have the activity in Beads —
// nothing to fetch. Exit cleanly so the agent prompt still runs.
if (parsed.reconcileWorkoutId || parsed.forceActivityId || parsed.manualActivityIssueId) {
  console.log('[fetch-strava] skip — reconcile/reassign payload, activity already stored');
  return;
}
```

Replace with:

```typescript
// Manual reassign, sync, and reconcile payloads already have the activity in Beads —
// nothing to fetch. Exit cleanly so the agent prompt still runs.
if (parsed.activityIssueId || parsed.reconcileWorkoutId || parsed.forceActivityId || parsed.manualActivityIssueId) {
  console.log('[fetch-strava] skip — activity already stored');
  return;
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter @abacus-products/marathon typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/marathon/abacus.json packages/marathon/scripts/fetch-and-store-strava.ts
git commit -m "feat(marathon): register sync-strava webhook; update process_activity prompt"
```

---

## Task 4: Update `manual-activity-shim.ts` — route reassign through agent

Remove the hardcoded `deviationStatus: 'met'` in the `op: reassign` path. Enqueue `process_activity` with `activityIssueId` + `workoutId` instead of `daily_reeval`.

**Files:**
- Modify: `packages/marathon/scripts/manual-activity-shim.ts`
- Modify: `packages/marathon/tests/manual-activity-shim.test.ts`

- [ ] **Step 1: Update the reassign test expectations first**

In `tests/manual-activity-shim.test.ts`, replace the entire `manualActivityCore — reassign` describe block:

```typescript
describe('manualActivityCore — reassign', () => {
  it('enqueues process_activity with activityIssueId and workoutId', async () => {
    const beads = makeBeads([
      { id: 'a-9', labels: ['marathon:strava-activity'], metadata: {}, status: 'open' },
      { id: 'w-9', labels: ['marathon:workout'], metadata: {}, status: 'open' },
    ]);
    const queue = makeQueue();
    await manualActivityCore(
      { op: 'reassign', activityIssueId: 'a-9', workoutId: 'w-9' },
      { beads: beads as any, queue: queue as any },
    );
    expect(queue.enqueued[0].kind).toBe('process_activity');
    expect(queue.enqueued[0].payload.activityIssueId).toBe('a-9');
    expect(queue.enqueued[0].payload.workoutId).toBe('w-9');
  });

  it('does not write actual directly onto the workout', async () => {
    const beads = makeBeads([
      { id: 'a-9', labels: ['marathon:strava-activity'], metadata: {}, status: 'open' },
      { id: 'w-9', labels: ['marathon:workout'], metadata: {}, status: 'open' },
    ]);
    const queue = makeQueue();
    await manualActivityCore(
      { op: 'reassign', activityIssueId: 'a-9', workoutId: 'w-9' },
      { beads: beads as any, queue: queue as any },
    );
    const workout = beads.issues.find((i) => i.id === 'w-9')!;
    // Agent sets actual, not the shim
    expect((workout.metadata as any).actual).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm reassign test now fails**

```bash
pnpm --filter @abacus-products/marathon test tests/manual-activity-shim.test.ts
```

Expected: the two new reassign tests FAIL, all others pass.

- [ ] **Step 3: Update the `op: reassign` block in `manual-activity-shim.ts`**

Replace the entire `if (req.op === 'reassign')` block (from the `if` line through its closing `}`) with:

```typescript
  if (req.op === 'reassign') {
    const workout = await beads.show(req.workoutId);
    if (!workout.labels.includes(TYPE_WORKOUT)) {
      throw new Error(`not a workout: ${req.workoutId}`);
    }
    const activity = await beads.show(req.activityIssueId);
    if (!activity.labels.includes(TYPE_STRAVA_ACTIVITY)) {
      throw new Error(`not a strava-activity: ${req.activityIssueId}`);
    }

    await queue.enqueue({
      product: 'marathon',
      kind: 'process_activity',
      payload: {
        activityIssueId: req.activityIssueId,
        workoutId: req.workoutId,
      },
      dedupeKey: `manual-reassign:${req.workoutId}:${req.activityIssueId}`,
    });
    return { reassigned: { workoutId: req.workoutId, activityIssueId: req.activityIssueId } };
  }
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @abacus-products/marathon test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/marathon/scripts/manual-activity-shim.ts packages/marathon/tests/manual-activity-shim.test.ts
git commit -m "feat(marathon): manual reassign routes through process_activity agent"
```

---

## Task 5: Expose `lastSyncedAt` in dashboard state type

`get-state.ts` already spreads `...planMeta` into the plan object, so `lastSyncedAt` flows through automatically once it's stored. Only the TypeScript interface needs updating.

**Files:**
- Modify: `packages/marathon/dashboard/lib/abacus.ts`

- [ ] **Step 1: Add `lastSyncedAt` to the `Plan` interface**

In `packages/marathon/dashboard/lib/abacus.ts`, find the `Plan` interface:

```typescript
export interface Plan {
  id: string;
  status: string;
  title: string;
  raceDate?: string;
  goalPace?: string;
  startDate?: string;
  weeks?: number;
}
```

Add `lastSyncedAt`:

```typescript
export interface Plan {
  id: string;
  status: string;
  title: string;
  raceDate?: string;
  goalPace?: string;
  startDate?: string;
  weeks?: number;
  lastSyncedAt?: string;
}
```

- [ ] **Step 2: Type-check dashboard**

```bash
pnpm --filter @abacus-products/marathon-dashboard typecheck 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/marathon/dashboard/lib/abacus.ts
git commit -m "feat(marathon): expose lastSyncedAt in Plan state type"
```

---

## Task 6: Add sync button and last-synced label to Dashboard

**Files:**
- Modify: `packages/marathon/dashboard/components/Dashboard.tsx`

- [ ] **Step 1: Add sync state and handler**

In `Dashboard.tsx`, after the existing state declarations (around line 118, after `const [matching, setMatching] = useState(false);`), add:

```typescript
  const [syncing, setSyncing] = useState(false);

  async function onSync() {
    if (!state?.plan?.id) return;
    setSyncing(true);
    try {
      await webhookPost('sync-strava', { planId: state.plan.id });
      await refresh();
    } catch (err) {
      console.error('sync failed', err);
    } finally {
      setSyncing(false);
    }
  }
```

- [ ] **Step 2: Add the last-synced helper function**

After the `daysUntil` function (around line 28), add:

```typescript
function lastSyncedLabel(iso: string | undefined): string {
  if (!iso) return 'Never synced';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.floor(hrs / 24)}d ago`;
}
```

- [ ] **Step 3: Add a persistent activities bar above the unmatched section**

The sync button must always be visible — even when all activities are matched. Find the unmatched section (around line 308):

```tsx
{/* Unmatched / extra activities (didn't map to a planned workout) */}
{unmatched.length > 0 ? (
  <section className="mb-6">
```

Insert a new persistent section **before** the existing unmatched section:

```tsx
{/* Activities bar — always shown when there's an active plan */}
{state.plan && (
  <section className="mb-4">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-widest text-muted">Activities</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-600">
          {lastSyncedLabel(state.plan?.lastSyncedAt)}
        </span>
        <button
          type="button"
          onClick={() => void onSync()}
          disabled={syncing}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>
    </div>
  </section>
)}

{/* Unmatched / extra activities (didn't map to a planned workout) */}
{unmatched.length > 0 ? (
  <section className="mb-6">
```

Leave the existing unmatched section and its "Match by date" button unchanged.

- [ ] **Step 4: Update the confirm match button feedback**

Find `onConfirmMatch` (around line 190) and update the post-confirm feedback. After `setMatchPreview(null);`, the UI refresh happens automatically via `void refresh()`. Change the button label area to show "Queued for matching" briefly. Replace the confirm button inside the match preview:

```tsx
<button
  type="button"
  onClick={onConfirmMatch}
  disabled={matching}
  className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
>
  {matching ? 'Matching…' : 'Confirm'}
</button>
```

with:

```tsx
<button
  type="button"
  onClick={onConfirmMatch}
  disabled={matching}
  className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
>
  {matching ? 'Queuing…' : 'Confirm'}
</button>
```

- [ ] **Step 5: Type-check**

```bash
pnpm --filter @abacus-products/marathon-dashboard typecheck 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/marathon/dashboard/components/Dashboard.tsx
git commit -m "feat(marathon): add sync button with last-synced label to dashboard"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @abacus-products/marathon test
```

Expected: all tests pass.

- [ ] **Step 2: Build everything**

```bash
pnpm --filter @abacus/platform build && pnpm --filter @abacus-products/marathon build && pnpm --filter @abacus-products/marathon-dashboard build 2>&1 | tail -10
```

Expected: all three builds succeed with no type errors.

- [ ] **Step 3: Verify sync button is visible**

Start the dev server and check `http://localhost:3000`:

```bash
pnpm --filter @abacus-products/marathon-dashboard dev
```

- Confirm the "Sync" button appears in the unmatched activities section header
- Confirm "Never synced" label appears next to it (since `lastSyncedAt` not set yet)
- Click Sync, confirm "Syncing…" state appears then resolves

- [ ] **Step 4: Push to remote**

```bash
git push origin main
```
