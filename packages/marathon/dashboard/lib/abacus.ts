export const ABACUS_URL = process.env.NEXT_PUBLIC_ABACUS_URL ?? 'http://127.0.0.1:3001';

export async function getState(): Promise<MarathonState> {
  const res = await fetch(`${ABACUS_URL}/api/marathon/state`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`getState: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as MarathonState;
}

export async function invoke(
  kind: string,
  payload: unknown,
  dedupeKey?: string,
): Promise<{ taskId: string; status: string }> {
  const body: Record<string, unknown> = { kind, payload };
  if (dedupeKey) body.dedupeKey = dedupeKey;
  const res = await fetch(`${ABACUS_URL}/api/marathon/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`invoke: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { taskId: string; status: string };
}

export function eventsUrl(): string {
  return `${ABACUS_URL}/api/marathon/events`;
}

export function taskStreamUrl(taskId: string): string {
  return `${ABACUS_URL}/api/marathon/task/${taskId}/stream`;
}

export interface Workout {
  id: string;
  status: string;
  title: string;
  date?: string;
  kind?: string;
  completed?: boolean;
  targetDurationMin?: number;
  targetPace?: string;
  weekBlockId?: string;
  notes?: string;
}

export interface WeekBlock {
  id: string;
  status: string;
  index: number;
  theme: string;
  startDate: string;
  workouts: Workout[];
}

export interface Plan {
  id: string;
  status: string;
  title: string;
  raceDate?: string;
  goalPace?: string;
  startDate?: string;
  weeks?: number;
}

export interface EffortEntry {
  id: string;
  status: string;
  title: string;
  updatedAt?: string;
  workoutId?: string;
  score?: number;
  notes?: string;
}

export interface ActivityEntry {
  id: string;
  status: string;
  title: string;
  updatedAt?: string;
  activityId?: number;
  aspectType?: string;
  name?: string;
  sportType?: string;
  distance?: number;
  movingTime?: number;
  startDateLocal?: string;
}

export interface FlagEntry {
  id: string;
  status: string;
  title: string;
  updatedAt?: string;
  reason?: string;
  severity?: string;
  raisedAt?: string;
}

export interface MarathonState {
  todayIso: string;
  plan: Plan | null;
  weeks: WeekBlock[];
  currentWeekIndex: number | null;
  recentEfforts: EffortEntry[];
  recentActivities: ActivityEntry[];
  flags: FlagEntry[];
}
