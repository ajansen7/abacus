#!/usr/bin/env tsx
/**
 * Pre-script: fetch the full Strava activity referenced by a webhook payload,
 * persist it as a `marathon:strava-activity` Beads issue. Pure IO + schema —
 * no judgement. The agent decides what to do with it on the next step.
 *
 * Env (set by ClaudeRunner):
 *   ABACUS_PAYLOAD — JSON-encoded Strava webhook body
 *   STRAVA_REFRESH_TOKEN, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET — credentials
 *
 * If `STRAVA_OFFLINE=1` is set, skips the API call and writes the webhook body
 * verbatim. Useful for tests and dev without live Strava credentials.
 */
import { Beads } from '@abacus/platform';
import { StravaWebhookPayload, TYPE_STRAVA_ACTIVITY } from '../lib/types.js';
import { createStravaClient } from '../lib/strava-client.js';

async function main(): Promise<void> {
  const raw = process.env.ABACUS_PAYLOAD;
  if (!raw) throw new Error('fetch-and-store-strava: ABACUS_PAYLOAD env not set');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  // Manual reassign / reconcile payloads already have the activity in Beads —
  // nothing to fetch. Exit cleanly so the agent prompt still runs.
  if (parsed.reconcileWorkoutId || parsed.forceActivityId || parsed.manualActivityIssueId) {
    console.log('[fetch-strava] skip — reconcile/reassign payload, activity already stored');
    return;
  }

  const webhook = StravaWebhookPayload.parse(parsed);

  const offline = process.env.STRAVA_OFFLINE === '1';

  let activity: unknown;
  if (offline) {
    activity = webhook;
  } else {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    const refreshToken = process.env.STRAVA_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        'fetch-and-store-strava: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN required (or set STRAVA_OFFLINE=1)',
      );
    }
    const client = createStravaClient({ clientId, clientSecret, refreshToken });
    activity = await client.fetchActivity(webhook.object_id);
  }

  // Trim the raw Strava response to only the fields we need for reasoning,
  // display, and reconciliation. The full DetailedActivity response includes
  // massive polyline strings, segment_efforts[], splits arrays, photos, etc.
  // that bloat hot memory and burn tokens without adding value.
  const rawAct = activity as Record<string, unknown>;
  const trimmedActivity = {
    id: rawAct.id,
    name: rawAct.name,
    type: rawAct.type,
    sport_type: rawAct.sport_type,
    start_date: rawAct.start_date,
    start_date_local: rawAct.start_date_local,
    distance: rawAct.distance,
    moving_time: rawAct.moving_time,
    elapsed_time: rawAct.elapsed_time,
    total_elevation_gain: rawAct.total_elevation_gain,
    elev_high: rawAct.elev_high,
    elev_low: rawAct.elev_low,
    average_speed: rawAct.average_speed,
    max_speed: rawAct.max_speed,
    average_heartrate: rawAct.average_heartrate,
    max_heartrate: rawAct.max_heartrate,
    suffer_score: rawAct.suffer_score,
    average_cadence: rawAct.average_cadence,
    description: rawAct.description,
  };

  const beads = new Beads();
  const id = await beads.create({
    title: `Strava activity ${webhook.object_id} (${webhook.aspect_type})`,
    labels: [TYPE_STRAVA_ACTIVITY, 'product:marathon'],
    metadata: {
      activityId: webhook.object_id,
      aspectType: webhook.aspect_type,
      ownerId: webhook.owner_id,
      subscriptionId: webhook.subscription_id,
      eventTimeUnix: webhook.event_time,
      fetchedAt: new Date().toISOString(),
      offline,
      activity: trimmedActivity,
    },
  });
  console.log(`[fetch-strava] ${id} (offline=${offline})`);
}

main().catch((err) => {
  console.error('[fetch-strava] fatal', err);
  process.exit(1);
});
