#!/usr/bin/env tsx
/**
 * Exercises the generic webhook-shim mechanism against the real marathon
 * product's strava shim. No tunnel, no Strava API — just confirms:
 *   1. GET handshake with correct verify_token returns a respond action
 *   2. GET with wrong verify_token returns a reject action
 *   3. POST with a valid webhook body returns an enqueue action with dedupe
 *   4. POST with malformed JSON returns a reject action
 *
 * Run: `pnpm --filter @abacus/platform smoke:webhook`
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductRegistry, runWebhookShim } from '../src/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGES_DIR = resolve(REPO_ROOT, 'packages');

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    console.error(`[webhook-smoke] FAIL — ${msg}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const registry = await ProductRegistry.load(PACKAGES_DIR);
  const product = registry.require('marathon');
  const handler = registry.webhookHandler('marathon', 'strava');
  assert(handler, 'marathon did not register a strava webhook handler');

  const verifyToken = 'test-verify-token';
  const priorVerify = process.env.STRAVA_VERIFY_TOKEN;
  process.env.STRAVA_VERIFY_TOKEN = verifyToken;

  try {
    const okHandshake = await runWebhookShim({
      product,
      source: 'strava',
      handler: handler!,
      request: {
        method: 'GET',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': verifyToken,
          'hub.challenge': 'sentinel-xyz-123',
        },
        headers: {},
        body: '',
      },
    });
    assert(okHandshake.kind === 'respond', `expected respond, got ${okHandshake.kind}`);
    if (okHandshake.kind === 'respond') {
      assert(
        okHandshake.body.includes('sentinel-xyz-123'),
        'handshake body should echo challenge',
      );
    }
    console.error('[webhook-smoke] handshake ok');

    const badHandshake = await runWebhookShim({
      product,
      source: 'strava',
      handler: handler!,
      request: {
        method: 'GET',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'doesnt-matter',
        },
        headers: {},
        body: '',
      },
    });
    assert(badHandshake.kind === 'reject', `expected reject, got ${badHandshake.kind}`);
    if (badHandshake.kind === 'reject') {
      assert(badHandshake.status === 403, `expected 403, got ${badHandshake.status}`);
    }
    console.error('[webhook-smoke] wrong-token rejection ok');

    const sampleEvent = {
      object_type: 'activity',
      object_id: 123456789,
      aspect_type: 'create',
      owner_id: 42,
      subscription_id: 99,
      event_time: 1_700_000_000,
    };
    const enqueued = await runWebhookShim({
      product,
      source: 'strava',
      handler: handler!,
      request: {
        method: 'POST',
        query: {},
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sampleEvent),
      },
    });
    assert(enqueued.kind === 'enqueue', `expected enqueue, got ${enqueued.kind}`);
    if (enqueued.kind === 'enqueue') {
      assert(enqueued.taskKind === 'process_activity', 'enqueue taskKind mismatch');
      assert(enqueued.dedupeKey?.includes('99'), 'dedupeKey should include subscription_id');
      assert(
        enqueued.dedupeKey?.includes('123456789'),
        'dedupeKey should include object_id',
      );
    }
    console.error('[webhook-smoke] enqueue action ok');

    const badPost = await runWebhookShim({
      product,
      source: 'strava',
      handler: handler!,
      request: {
        method: 'POST',
        query: {},
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      },
    });
    assert(badPost.kind === 'reject', `expected reject, got ${badPost.kind}`);
    console.error('[webhook-smoke] malformed-json rejection ok');
  } finally {
    if (priorVerify === undefined) {
      delete process.env.STRAVA_VERIFY_TOKEN;
    } else {
      process.env.STRAVA_VERIFY_TOKEN = priorVerify;
    }
  }

  console.error('[webhook-smoke] OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[webhook-smoke] fatal', err);
  process.exit(1);
});
