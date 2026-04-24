#!/usr/bin/env tsx
/**
 * Find detached tmux sessions named `abacus-*` that correspond to a task whose
 * Beads record is terminal (completed/failed) or missing, and kill them. Solves
 * the case where a dispatcher crash leaves a session running after the platform
 * moved on.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Beads } from '../src/beads.js';
import { Queue } from '../src/queue.js';
import { loadConfig } from '../src/config.js';

const execFileAsync = promisify(execFile);

async function listTmuxSessions(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).message ?? '';
    if (/no server running/i.test(msg)) return [];
    throw err;
  }
}

async function killSession(name: string): Promise<void> {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', name]);
  } catch {
    /* ignore — already gone */
  }
}

async function main(): Promise<void> {
  loadConfig();
  const beads = new Beads();
  const queue = new Queue(beads, 60);

  const sessions = await listTmuxSessions();
  const abacusSessions = sessions.filter((s) => s.startsWith('abacus-'));
  if (abacusSessions.length === 0) {
    console.log('reap-tmux-orphans: no abacus-* sessions live');
    return;
  }

  let reaped = 0;
  for (const session of abacusSessions) {
    const taskId = session.replace(/^abacus-/, '');
    try {
      const task = await queue.get(taskId);
      if (task.status === 'completed' || task.status === 'failed') {
        await killSession(session);
        reaped += 1;
        console.log(`reaped ${session} (task ${taskId} status=${task.status})`);
      }
    } catch {
      await killSession(session);
      reaped += 1;
      console.log(`reaped ${session} (task ${taskId} not found)`);
    }
  }
  console.log(`reap-tmux-orphans: ${reaped} session(s) killed`);
}

main().catch((err) => {
  console.error('reap-tmux-orphans: fatal', err);
  process.exit(1);
});
