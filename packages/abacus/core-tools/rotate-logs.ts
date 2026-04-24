#!/usr/bin/env tsx
/**
 * Trim per-task log files under `runtime/logs/` older than a retention window.
 * Safe to run repeatedly; deletes files only.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const RUNTIME_DIR = process.env.ABACUS_RUNTIME_DIR ?? 'runtime';
const RETAIN_DAYS = Number.parseInt(process.env.ABACUS_LOG_RETAIN_DAYS ?? '14', 10);

async function main(): Promise<void> {
  const logsDir = resolve(RUNTIME_DIR, 'logs');
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch {
    console.log(`rotate-logs: no logs directory at ${logsDir}`);
    return;
  }
  const cutoffMs = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const path = join(logsDir, name);
    const s = await stat(path);
    if (s.mtimeMs < cutoffMs) {
      await unlink(path);
      removed += 1;
    }
  }
  console.log(`rotate-logs: removed ${removed} file(s) older than ${RETAIN_DAYS}d`);
}

main().catch((err) => {
  console.error('rotate-logs: fatal', err);
  process.exit(1);
});
