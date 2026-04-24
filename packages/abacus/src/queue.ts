import { z } from 'zod';
import type { Beads, BdIssue } from './beads.js';
import { AgentTask, TaskStatus } from './types.js';

const QUEUE_LABEL = 'platform:agent-task';

const TaskMeta = z
  .object({
    product: z.string(),
    kind: z.string(),
    payload: z.unknown(),
    status: TaskStatus,
    dedupe_key: z.string().optional(),
    tmux_session: z.string().optional(),
    created_at: z.string(),
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
    failure_reason: z.string().optional(),
  })
  .passthrough();

function issueToTask(issue: BdIssue): AgentTask {
  const meta = TaskMeta.parse(issue.metadata ?? {});
  return AgentTask.parse({
    id: issue.id,
    product: meta.product,
    kind: meta.kind,
    payload: meta.payload,
    status: meta.status,
    dedupeKey: meta.dedupe_key,
    tmuxSession: meta.tmux_session,
    createdAt: meta.created_at,
    startedAt: meta.started_at,
    finishedAt: meta.finished_at,
    failureReason: meta.failure_reason,
  });
}

export interface EnqueueResult {
  task: AgentTask;
  deduped: boolean;
}

export class Queue {
  constructor(
    private readonly beads: Beads,
    private readonly dedupeTtlSeconds: number,
  ) {}

  async list(filter?: { status?: TaskStatus; product?: string }): Promise<AgentTask[]> {
    const issues = await this.beads.list([QUEUE_LABEL]);
    const tasks = issues.map(issueToTask);
    return tasks.filter((t) => {
      if (filter?.status && t.status !== filter.status) return false;
      if (filter?.product && t.product !== filter.product) return false;
      return true;
    });
  }

  async get(id: string): Promise<AgentTask> {
    const issue = await this.beads.show(id);
    return issueToTask(issue);
  }

  async enqueue(params: {
    product: string;
    kind: string;
    payload: unknown;
    dedupeKey?: string;
  }): Promise<EnqueueResult> {
    if (params.dedupeKey) {
      const hit = await this.findDedupe(params.product, params.kind, params.dedupeKey);
      if (hit) return { task: hit, deduped: true };
    }

    const createdAt = new Date().toISOString();
    const meta = {
      product: params.product,
      kind: params.kind,
      payload: params.payload,
      status: 'pending' as TaskStatus,
      created_at: createdAt,
      ...(params.dedupeKey ? { dedupe_key: params.dedupeKey } : {}),
    };
    const id = await this.beads.create({
      title: `${params.product}/${params.kind}`,
      labels: [QUEUE_LABEL, `product:${params.product}`, `kind:${params.kind}`],
      metadata: meta,
    });
    return { task: await this.get(id), deduped: false };
  }

  private async findDedupe(
    product: string,
    kind: string,
    dedupeKey: string,
  ): Promise<AgentTask | null> {
    const tasks = await this.list({ product });
    const now = Date.now();
    const ttlMs = this.dedupeTtlSeconds * 1000;
    for (const t of tasks) {
      if (t.kind !== kind || t.dedupeKey !== dedupeKey) continue;
      const createdMs = Date.parse(t.createdAt);
      if (now - createdMs <= ttlMs) return t;
    }
    return null;
  }

  async claimNext(): Promise<AgentTask | null> {
    const pending = (await this.list({ status: 'pending' })).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const next = pending[0];
    if (!next) return null;
    const startedAt = new Date().toISOString();
    await this.beads.updateMetadata(next.id, {
      status: 'running',
      started_at: startedAt,
    });
    return { ...next, status: 'running', startedAt };
  }

  async markStarted(id: string, tmuxSession: string): Promise<void> {
    await this.beads.updateMetadata(id, { tmux_session: tmuxSession });
  }

  async markCompleted(id: string): Promise<void> {
    await this.beads.updateMetadata(id, {
      status: 'completed',
      finished_at: new Date().toISOString(),
    });
    await this.beads.close(id);
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.beads.updateMetadata(id, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      failure_reason: reason,
    });
    await this.beads.close(id);
  }
}
