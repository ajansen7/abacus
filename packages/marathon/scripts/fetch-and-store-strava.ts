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

interface StravaTokenResponse {
  access_token: string;
  expires_at: number;
}

async function refreshAccessToken(env: NodeJS.ProcessEnv): Promise<string> {
  const clientId = env.STRAVA_CLIENT_ID;
  const clientSecret = env.STRAVA_CLIENT_SECRET;
  const refresh = env.STRAVA_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refresh) {
    throw new Error(
      'fetch-and-store-strava: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN required (or set STRAVA_OFFLINE=1)',
    );
  }
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  if (!res.ok) {
    throw new Error(`strava token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as StravaTokenResponse;
  return json.access_token;
}

async function fetchActivity(activityId: number, accessToken: string): Promise<unknown> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`strava activity fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main(): Promise<void> {
  const raw = process.env.ABACUS_PAYLOAD;
  if (!raw) throw new Error('fetch-and-store-strava: ABACUS_PAYLOAD env not set');
  const webhook = StravaWebhookPayload.parse(JSON.parse(raw));

  const offline = process.env.STRAVA_OFFLINE === '1';
  const activity = offline ? webhook : await fetchActivityWithToken(webhook.object_id);

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

async function fetchActivityWithToken(activityId: number): Promise<unknown> {
  const token = await refreshAccessToken(process.env);
  return fetchActivity(activityId, token);
}

main().catch((err) => {
  console.error('[fetch-strava] fatal', err);
  process.exit(1);
});
