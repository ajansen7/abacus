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

export async function webhookPost(name: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${ABACUS_URL}/api/marathon/webhook/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`webhook ${name}: ${res.status} ${await res.text()}`);
  return res.json();
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

export interface WorkoutActual {
  activityId?: string;
  activityKind: string;
  source: string;
  deviationStatus: 'met' | 'partial' | 'swapped' | 'skipped' | 'extra';
  durationMin?: number;
  notes?: string;
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
  actual?: WorkoutActual;
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
  lastSyncedAt?: string;
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

export interface FullActivityEntry {
  id: string;
  status: string;
  title: string;
  updatedAt?: string;
  activityId?: number | string;
  source?: string;
  aspectType?: string;
  name?: string;
  sportType?: string;
  distance?: number;
  movingTime?: number;
  startDateLocal?: string;
  totalElevationGain?: number;
  elevHigh?: number;
  elevLow?: number;
  averageHeartrate?: number;
  maxHeartrate?: number;
  sufferScore?: number;
  averageCadence?: number;
  averageSpeed?: number;
}

export interface RaceEntry {
  id: string;
  status: string;
  name?: string;
  date?: string;
  distance?: string;
  location?: string;
  goalFinishTime?: string;
}

export interface PlanContextEntry {
  id: string;
  planId?: string;
  notes?: string;
  updatedAt?: string;
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
  race: RaceEntry | null;
  planContext: PlanContextEntry | null;
  weeks: WeekBlock[];
  currentWeekIndex: number | null;
  recentEfforts: EffortEntry[];
  recentActivities: ActivityEntry[];
  allActivities: FullActivityEntry[];
  flags: FlagEntry[];
}
