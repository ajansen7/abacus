import { mkdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Queue } from './queue.js';
import type { Runner } from './runner.js';
import type { SseBus } from './sse.js';
import type { Tmux } from './tmux.js';
import { Watchdog, type WatchdogArm, type WatchdogReason } from './watchdog.js';
import type { AgentTask } from './types.js';

export interface DispatcherDeps {
  queue: Queue;
  tmux: Tmux;
  sse: SseBus;
  runner: Runner;
  runtimeDir: string;
  pollIntervalMs: number;
  maxWallclockSeconds: number;
  logger?: (msg: string, extra?: Record<string, unknown>) => void;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class Dispatcher {
  private readonly queue: Queue;
  private readonly tmux: Tmux;
  private readonly sse: SseBus;
  private readonly runner: Runner;
  private readonly runtimeDir: string;
  private readonly pollIntervalMs: number;
  private readonly maxWallclockMs: number;
  private readonly watchdog = new Watchdog();
  private readonly log: (msg: string, extra?: Record<string, unknown>) => void;

  private running = false;
  private stopRequested = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private readonly active = new Map<string, WatchdogArm>();

  constructor(deps: DispatcherDeps) {
    this.queue = deps.queue;
    this.tmux = deps.tmux;
    this.sse = deps.sse;
    this.runner = deps.runner;
    this.runtimeDir = resolve(deps.runtimeDir);
    this.pollIntervalMs = deps.pollIntervalMs;
    this.maxWallclockMs = deps.maxWallclockSeconds * 1000;
    this.log = deps.logger ?? (() => {});
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    for (const arm of this.active.values()) arm.cancel();
    this.active.clear();
  }

  private scheduleTick(): void {
    if (this.stopRequested) {
      this.running = false;
      return;
    }
    this.tickTimer = setTimeout(() => void this.tick(), this.pollIntervalMs);
    this.tickTimer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const claimed = await this.queue.claimNext();
      if (claimed) {
        await this.launch(claimed);
      }
    } catch (err) {
      this.log('dispatcher.tick.error', { err: String(err) });
    }
    this.scheduleTick();
  }

  private async launch(task: AgentTask): Promise<void> {
    const session = task.id.startsWith('abacus-') ? task.id : `abacus-${task.id}`;
    const logsDir = join(this.runtimeDir, 'logs');
    const jobsDir = join(this.runtimeDir, 'jobs', task.id);
    await mkdir(logsDir, { recursive: true });
    await mkdir(jobsDir, { recursive: true });
    const logFile = join(logsDir, `${task.id}.log`);
    const exitFile = join(jobsDir, 'exit.code');

    const prepared = await this.runner.prepare({
      taskId: task.id,
      taskDir: jobsDir,
      logFile,
      exitFile,
      product: task.product,
      kind: task.kind,
      payload: task.payload,
    });

    await this.tmux.spawn({
      session,
      cwd: prepared.cwd,
      logFile,
      command: prepared.command,
    });
    await this.queue.markStarted(task.id, session);
    this.sse.publish(task.product, {
      type: 'TASK_STARTED',
      taskId: task.id,
      tmuxSession: session,
    });

    const arm = this.watchdog.arm({
      maxWallclockMs: this.maxWallclockMs,
      onBreach: (reason) => this.handleBreach(task, session, reason),
    });
    this.active.set(task.id, arm);

    void this.awaitCompletion(task, session, exitFile, arm);
  }

  private async awaitCompletion(
    task: AgentTask,
    session: string,
    exitFile: string,
    arm: WatchdogArm,
  ): Promise<void> {
    let sessionMissingSince: number | null = null;
    const graceMs = Math.max(2 * this.pollIntervalMs, 2000);
    while (!this.stopRequested) {
      if (await fileExists(exitFile)) {
        const raw = (await readFile(exitFile, 'utf8')).trim();
        const code = Number.parseInt(raw, 10);
        arm.cancel();
        this.active.delete(task.id);
        await this.tmux.kill(session);
        if (code === 0) {
          await this.queue.markCompleted(task.id);
          this.sse.publish(task.product, { type: 'TASK_COMPLETE', taskId: task.id });
        } else {
          const reason = `runner_exit_${Number.isFinite(code) ? code : 'unknown'}`;
          await this.queue.markFailed(task.id, reason);
          this.sse.publish(task.product, {
            type: 'TASK_FAILED',
            taskId: task.id,
            reason,
          });
        }
        return;
      }
      const alive = await this.tmux.exists(session);
      if (!alive) {
        if (sessionMissingSince === null) sessionMissingSince = Date.now();
        else if (Date.now() - sessionMissingSince >= graceMs) {
          arm.cancel();
          this.active.delete(task.id);
          const reason = 'runner_crashed';
          await this.queue.markFailed(task.id, reason);
          this.sse.publish(task.product, {
            type: 'TASK_FAILED',
            taskId: task.id,
            reason,
          });
          return;
        }
      } else {
        sessionMissingSince = null;
      }
      await new Promise<void>((r) => {
        const t = setTimeout(r, this.pollIntervalMs);
        t.unref();
      });
    }
  }

  private async handleBreach(
    task: AgentTask,
    session: string,
    reason: WatchdogReason,
  ): Promise<void> {
    if (!this.active.has(task.id)) return;
    this.active.delete(task.id);
    await this.tmux.kill(session);
    await this.queue.markFailed(task.id, reason);
    this.sse.publish(task.product, {
      type: 'TASK_FAILED',
      taskId: task.id,
      reason,
    });
  }
}
