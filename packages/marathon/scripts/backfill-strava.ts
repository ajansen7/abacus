#!/usr/bin/env tsx
import { Beads } from '@abacus/platform';
import { createStravaClient, type StravaClient } from '../lib/strava-client.js';
import { TYPE_STRAVA_ACTIVITY } from '../lib/types.js';

interface BackfillDeps {
  beads: { list: (labels: string[]) => Promise<any[]>; create: (issue: any) => Promise<string> };
  strava: Pick<StravaClient, 'listActivities'>;
  sinceUnix: number;
  beforeUnix?: number;
}

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = JSON.parse(process.env.ABACUS_PAYLOAD ?? '{}');
  const sinceIso = payload.sinceDate as string | undefined;
  if (!sinceIso) {
    console.error('backfill-strava: payload.sinceDate required (YYYY-MM-DD)');
    process.exit(2);
  }
  const sinceUnix = Math.floor(new Date(`${sinceIso}T00:00:00Z`).getTime() / 1000);
  const beads = new Beads();
  const strava = createStravaClient({
    clientId: process.env.STRAVA_CLIENT_ID!,
    clientSecret: process.env.STRAVA_CLIENT_SECRET!,
    refreshToken: process.env.STRAVA_REFRESH_TOKEN!,
  });
  backfillCore({ beads: beads as any, strava, sinceUnix }).then((r) => {
    console.log(JSON.stringify({ ok: true, ...r }));
  });
}
