#!/usr/bin/env tsx
/**
 * Marathon webhook shim for Strava. Invoked by the platform on every request
 * at `/api/marathon/webhook/strava`. Reads request context from env, writes
 * one JSON action to stdout:
 *
 *   GET  ?hub.mode=subscribe   → verify token, echo hub.challenge
 *   POST <strava event body>   → enqueue process_activity task, deduped on
 *                                (subscription_id, object_id, aspect_type, event_time)
 *
 * Keeps all Strava-specific logic inside the marathon product — platform stays
 * ZFC-pure.
 */
import { StravaWebhookPayload } from '../lib/types.js';

interface Action {
  kind: 'respond' | 'enqueue' | 'reject';
  [key: string]: unknown;
}

function parseJsonEnv<T>(key: string, fallback: T): T | Record<string, unknown> {
  const raw = process.env[key];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function respond(action: Action): void {
  process.stdout.write(JSON.stringify(action));
  process.exit(0);
}

function handleGet(query: Record<string, unknown>): void {
  const mode = query['hub.mode'];
  const verifyToken = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const expected = process.env.STRAVA_VERIFY_TOKEN;

  if (mode !== 'subscribe') {
    respond({ kind: 'reject', status: 400, reason: `unexpected hub.mode: ${String(mode)}` });
    return;
  }
  if (!expected) {
    respond({
      kind: 'reject',
      status: 500,
      reason: 'STRAVA_VERIFY_TOKEN not configured',
    });
    return;
  }
  if (verifyToken !== expected) {
    respond({ kind: 'reject', status: 403, reason: 'verify_token mismatch' });
    return;
  }
  if (typeof challenge !== 'string' || !challenge) {
    respond({ kind: 'reject', status: 400, reason: 'missing hub.challenge' });
    return;
  }
  respond({
    kind: 'respond',
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ 'hub.challenge': challenge }),
  });
}

function handlePost(body: string): void {
  if (!body) {
    respond({ kind: 'reject', status: 400, reason: 'empty body' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    respond({ kind: 'reject', status: 400, reason: `invalid json: ${(err as Error).message}` });
    return;
  }
  const result = StravaWebhookPayload.safeParse(parsed);
  if (!result.success) {
    respond({ kind: 'reject', status: 400, reason: `schema: ${result.error.message}` });
    return;
  }
  const event = result.data;
  const dedupeKey = [
    'strava',
    event.subscription_id,
    event.object_type,
    event.object_id,
    event.aspect_type,
    event.event_time,
  ].join(':');

  respond({
    kind: 'enqueue',
    taskKind: 'process_activity',
    payload: event,
    dedupeKey,
    status: 202,
  });
}

function main(): void {
  const method = (process.env.ABACUS_HTTP_METHOD ?? 'GET').toUpperCase();
  const query = parseJsonEnv('ABACUS_HTTP_QUERY', {}) as Record<string, unknown>;
  const body = process.env.ABACUS_HTTP_BODY ?? '';

  if (method === 'GET') {
    handleGet(query);
    return;
  }
  if (method === 'POST') {
    handlePost(body);
    return;
  }
  respond({ kind: 'reject', status: 405, reason: `unsupported method: ${method}` });
}

main();
