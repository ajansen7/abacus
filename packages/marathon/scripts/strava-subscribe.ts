#!/usr/bin/env tsx
/**
 * Strava push-subscription CLI. One subscription per Strava app; re-running
 * create while one exists will fail with 400. Use --list / --delete first.
 *
 * Usage:
 *   # Create (default)
 *   tsx scripts/strava-subscribe.ts --callback https://<ngrok-id>.ngrok.app/api/marathon/webhook/strava
 *
 *   # List existing subscriptions
 *   tsx scripts/strava-subscribe.ts --list
 *
 *   # Delete by id
 *   tsx scripts/strava-subscribe.ts --delete 12345
 *
 * Prereqs in .env.local:
 *   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN
 */
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_LOCAL = resolve(REPO_ROOT, '.env.local');
const STRAVA_SUB_URL = 'https://www.strava.com/api/v3/push_subscriptions';

type Mode = 'create' | 'list' | 'delete';

interface CliFlags {
  mode: Mode;
  callback?: string;
  deleteId?: string;
}

function parseFlags(argv: string[]): CliFlags {
  const out: CliFlags = { mode: 'create' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith('--')) continue;
    switch (flag) {
      case '--list':
        out.mode = 'list';
        break;
      case '--delete':
        if (!value) throw new Error('--delete requires a subscription id');
        out.mode = 'delete';
        out.deleteId = value;
        i += 1;
        break;
      case '--callback':
        if (!value) throw new Error('--callback requires a URL');
        out.callback = value;
        i += 1;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadEnvLocal(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!(await fileExists(ENV_LOCAL))) return map;
  const raw = await readFile(ENV_LOCAL, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

async function getCreds(opts: { requireVerify: boolean }): Promise<{
  clientId: string;
  clientSecret: string;
  verifyToken?: string;
}> {
  const env = await loadEnvLocal();
  const clientId = env.get('STRAVA_CLIENT_ID') ?? process.env.STRAVA_CLIENT_ID;
  const clientSecret = env.get('STRAVA_CLIENT_SECRET') ?? process.env.STRAVA_CLIENT_SECRET;
  const verifyToken =
    env.get('STRAVA_VERIFY_TOKEN') ?? process.env.STRAVA_VERIFY_TOKEN;
  if (!clientId || !clientSecret) {
    throw new Error(
      'strava-subscribe: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET must be set in .env.local',
    );
  }
  if (opts.requireVerify && (!verifyToken || verifyToken === 'change-me-to-a-random-string')) {
    throw new Error(
      'strava-subscribe: STRAVA_VERIFY_TOKEN must be set in .env.local (pick any random string)',
    );
  }
  return verifyToken ? { clientId, clientSecret, verifyToken } : { clientId, clientSecret };
}

async function list(): Promise<void> {
  const { clientId, clientSecret } = await getCreds({ requireVerify: false });
  const url = new URL(STRAVA_SUB_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`list failed: ${res.status} ${await res.text()}`);
  }
  const subs = (await res.json()) as Array<{ id: number; callback_url: string; created_at: string }>;
  if (subs.length === 0) {
    console.log('[strava-subscribe] no active subscriptions');
    return;
  }
  for (const s of subs) {
    console.log(`[strava-subscribe] id=${s.id} url=${s.callback_url} created=${s.created_at}`);
  }
}

async function create(callback: string): Promise<void> {
  const { clientId, clientSecret, verifyToken } = await getCreds({ requireVerify: true });
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: callback,
    verify_token: verifyToken!,
  });
  // Clean up any existing subscriptions first (Strava only allows 1 per app)
  const listUrl = new URL(STRAVA_SUB_URL);
  listUrl.searchParams.set('client_id', clientId);
  listUrl.searchParams.set('client_secret', clientSecret);
  const listRes = await fetch(listUrl.toString());
  if (listRes.ok) {
    const subs = (await listRes.json()) as Array<{ id: number }>;
    if (subs.length > 0) {
      for (const s of subs) {
        console.log(`[strava-subscribe] removing orphaned subscription ${s.id}`);
        await fetch(`${STRAVA_SUB_URL}/${s.id}?client_id=${clientId}&client_secret=${clientSecret}`, { method: 'DELETE' });
      }
      // Strava's DELETE is eventually consistent; give the backend a moment to
      // process it before we POST a new subscription, otherwise we get a 400.
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }

  console.log(`[strava-subscribe] posting subscription for ${callback}`);
  const res = await fetch(STRAVA_SUB_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(`subscribe failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: number };
  console.log(`[strava-subscribe] OK — subscription id=${body.id}`);
}

async function remove(id: string): Promise<void> {
  const { clientId, clientSecret } = await getCreds({ requireVerify: false });
  const url = new URL(`${STRAVA_SUB_URL}/${id}`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  const res = await fetch(url.toString(), { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`delete failed: ${res.status} ${await res.text()}`);
  }
  console.log(`[strava-subscribe] deleted subscription ${id}`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.mode === 'list') {
    await list();
    return;
  }
  if (flags.mode === 'delete') {
    if (!flags.deleteId) throw new Error('--delete requires an id');
    await remove(flags.deleteId);
    return;
  }
  if (!flags.callback) {
    throw new Error('strava-subscribe: --callback <https-url> required for create mode');
  }
  if (!flags.callback.startsWith('https://')) {
    throw new Error('strava-subscribe: --callback must be an https URL');
  }
  await create(flags.callback);
}

main().catch((err) => {
  console.error('[strava-subscribe] fatal', err);
  process.exit(1);
});
