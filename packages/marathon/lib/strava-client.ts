import { z } from 'zod';

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number().int(),
});

export interface StravaCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface StravaClient {
  fetchActivity(activityId: number): Promise<unknown>;
  listActivities(params: { afterUnix: number; beforeUnix?: number; perPage?: number }): Promise<unknown[]>;
}

export function createStravaClient(creds: StravaCreds): StravaClient {
  let accessToken: string | undefined;
  let expiresAt = 0;

  async function refresh(): Promise<string> {
    if (accessToken && Date.now() / 1000 < expiresAt - 60) return accessToken;
    const res = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`strava token refresh failed: ${res.status}`);
    const tok = TokenResponse.parse(await res.json());
    accessToken = tok.access_token;
    expiresAt = tok.expires_at;
    return accessToken;
  }

  async function fetchActivity(activityId: number) {
    const t = await refresh();
    const r = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    if (!r.ok) throw new Error(`strava activity fetch failed: ${r.status}`);
    return r.json();
  }

  async function listActivities({ afterUnix, beforeUnix, perPage = 200 }: { afterUnix: number; beforeUnix?: number; perPage?: number }) {
    const t = await refresh();
    const out: unknown[] = [];
    let page = 1;
    while (true) {
      const url = new URL('https://www.strava.com/api/v3/athlete/activities');
      url.searchParams.set('after', String(afterUnix));
      if (beforeUnix !== undefined) url.searchParams.set('before', String(beforeUnix));
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      const r = await fetch(url, { headers: { authorization: `Bearer ${t}` } });
      if (!r.ok) throw new Error(`strava list failed: ${r.status}`);
      const batch = (await r.json()) as unknown[];
      out.push(...batch);
      if (batch.length < perPage) return out;
      page += 1;
    }
  }

  return { fetchActivity, listActivities };
}
