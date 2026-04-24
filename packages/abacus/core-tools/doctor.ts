#!/usr/bin/env tsx
/**
 * Preflight for the platform runtime. Verifies that every binary Abacus shells
 * out to is on PATH and prints each version. Exits non-zero if any check fails.
 * Agent-callable: same checks that `scripts/doctor.sh` runs, but in-process so
 * the platform can expose them as an MCP tool later.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface Check {
  name: string;
  bin: string;
  args: string[];
}

const CHECKS: Check[] = [
  { name: 'node', bin: 'node', args: ['--version'] },
  { name: 'pnpm', bin: 'pnpm', args: ['--version'] },
  { name: 'bd', bin: 'bd', args: ['--version'] },
  { name: 'dolt', bin: 'dolt', args: ['version'] },
  { name: 'tmux', bin: 'tmux', args: ['-V'] },
  { name: 'claude', bin: 'claude', args: ['--version'] },
];

async function runCheck(check: Check): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(check.bin, check.args, {
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, out: (stdout || stderr).trim().split('\n')[0] ?? '' };
  } catch (err) {
    return { ok: false, out: (err as Error).message };
  }
}

async function main(): Promise<void> {
  let failed = 0;
  for (const check of CHECKS) {
    const res = await runCheck(check);
    const status = res.ok ? 'ok' : 'MISSING';
    console.log(`${status.padEnd(7)} ${check.name.padEnd(8)} ${res.out}`);
    if (!res.ok) failed += 1;
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('doctor: fatal', err);
  process.exit(2);
});
