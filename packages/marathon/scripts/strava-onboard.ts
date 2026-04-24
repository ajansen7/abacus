#!/usr/bin/env tsx
/**
 * One-shot Strava OAuth onboarding. Spins up a tiny local HTTP server on
 * `--port` (default 43117), prints the authorize URL, waits for the redirect
 * callback, exchanges the code for an access + refresh token, and upserts
 * `STRAVA_REFRESH_TOKEN` into the repo's `.env.local`.
 *
 * Usage:
 *   pnpm --filter @abacus-products/marathon exec tsx scripts/strava-onboard.ts
 *
 * Prereqs in .env.local (repo root):
 *   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
 *
 * Strava app settings must have "Authorization Callback Domain" set to
 *   localhost
 * for http://localhost:<port>/callback to be accepted.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_LOCAL = resolve(REPO_ROOT, '.env.local');
const SCOPES = 'read,activity:read_all,profile:read_all';

interface CliFlags {
  port: number;
}

function parseFlags(argv: string[]): CliFlags {
  const out: CliFlags = { port: 43117 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith('--')) continue;
    if (flag === '--port') {
      if (!value) throw new Error('--port requires a value');
      out.port = Number.parseInt(value, 10);
      if (!Number.isFinite(out.port) || out.port <= 0) {
        throw new Error(`invalid --port: ${value}`);
      }
      i += 1;
    } else {
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

async function upsertEnvKey(key: string, value: string): Promise<void> {
  const existing = (await fileExists(ENV_LOCAL)) ? await readFile(ENV_LOCAL, 'utf8') : '';
  const lines = existing.split('\n');
  let replaced = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) return line;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return line;
    const lineKey = trimmed.slice(0, idx).trim();
    if (lineKey !== key) return line;
    replaced = true;
    return `${key}=${value}`;
  });
  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('');
    next.push(`${key}=${value}`);
  }
  let content = next.join('\n');
  if (!content.endsWith('\n')) content += '\n';
  await writeFile(ENV_LOCAL, content, 'utf8');
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string; username?: string };
}

async function exchangeCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<StravaTokenResponse> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`strava token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as StravaTokenResponse;
}

function waitForCallback(port: number): Promise<{ code: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end('missing url');
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.statusCode = 400;
        res.end(`strava returned error: ${error}. You can close this tab.`);
        server.close();
        rejectPromise(new Error(`strava authorize error: ${error}`));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end('missing code query param');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><html><body style="font-family:system-ui;padding:2rem"><h1>Onboarded.</h1><p>You can close this tab.</p></body></html>',
      );
      server.close();
      resolvePromise({ code });
    });
    server.on('error', rejectPromise);
    server.listen(port, '127.0.0.1');
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const env = await loadEnvLocal();
  const clientId = env.get('STRAVA_CLIENT_ID') ?? process.env.STRAVA_CLIENT_ID;
  const clientSecret = env.get('STRAVA_CLIENT_SECRET') ?? process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'strava-onboard: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET must be set in .env.local',
    );
  }

  const redirectUri = `http://localhost:${flags.port}/callback`;
  const authUrl = new URL('https://www.strava.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('approval_prompt', 'auto');
  authUrl.searchParams.set('scope', SCOPES);

  console.log('');
  console.log(`[strava-onboard] listening on ${redirectUri}`);
  console.log('[strava-onboard] open this URL in your browser:');
  console.log('');
  console.log(`  ${authUrl.toString()}`);
  console.log('');
  console.log('[strava-onboard] waiting for redirect… (Strava app must have');
  console.log('                 "Authorization Callback Domain" set to `localhost`)');

  const { code } = await waitForCallback(flags.port);
  console.log('[strava-onboard] received code, exchanging…');

  const tokens = await exchangeCode({ clientId, clientSecret, code });
  await upsertEnvKey('STRAVA_REFRESH_TOKEN', tokens.refresh_token);
  const who = tokens.athlete
    ? `${tokens.athlete.firstname ?? ''} ${tokens.athlete.lastname ?? ''}`.trim() ||
      tokens.athlete.username ||
      `athlete ${tokens.athlete.id}`
    : 'unknown athlete';
  console.log(`[strava-onboard] onboarded: ${who}`);
  console.log(`[strava-onboard] refresh token written to ${ENV_LOCAL}`);
  console.log(`[strava-onboard] access token expires at ${new Date(tokens.expires_at * 1000).toISOString()}`);
  console.log('[strava-onboard] OK');
}

main().catch((err) => {
  console.error('[strava-onboard] fatal', err);
  process.exit(1);
});
