'use client';
import type { FullActivityEntry } from '@/lib/abacus';
import { webhookPost } from '@/lib/abacus';

interface Props {
  activity: FullActivityEntry;
  onChange: () => void;
}

export function ActivityRow({ activity, onChange }: Props) {
  async function onDelete() {
    if (!confirm('Remove this activity from the plan?')) return;
    await webhookPost('manual_activity', { op: 'delete', activityIssueId: activity.id });
    onChange();
  }

  const durationMin = activity.movingTime ? Math.round(activity.movingTime / 60) : null;
  const dateStr = activity.startDateLocal ? activity.startDateLocal.slice(0, 10) : '';

  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-zinc-200">
          {activity.sportType || activity.name || '(activity)'}
        </span>
        <span className="text-xs text-muted">
          {dateStr}
          {durationMin !== null ? ` · ${durationMin} min` : ''}
          {activity.distance ? ` · ${(activity.distance / 1000).toFixed(1)} km` : ''}
          {activity.source === 'manual' ? ' · manual' : ''}
        </span>
      </div>
      <button
        onClick={onDelete}
        className="ml-3 shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:border-rose-400/50 hover:text-rose-400"
      >
        Remove
      </button>
    </div>
  );
}
