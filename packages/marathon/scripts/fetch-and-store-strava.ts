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
  const webhook = StravaWebhookPayload.parse(JSON.parse(raw));

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
      activity,
    },
  });
  console.log(`[fetch-strava] ${id} (offline=${offline})`);
}

main().catch((err) => {
  console.error('[fetch-strava] fatal', err);
  process.exit(1);
});
