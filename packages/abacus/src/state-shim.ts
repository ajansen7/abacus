import { spawn } from 'node:child_process';
import type { DiscoveredProduct, StateHandler } from './types.js';

export interface StateRequest {
  query: Record<string, string>;
}

export interface RunStateShimOptions {
  product: DiscoveredProduct;
  handler: StateHandler;
  request: StateRequest;
  /** Time budget for the subprocess. Default 10s. */
  timeoutMs?: number;
}

/**
 * Spawn a product's state shim and return its parsed JSON stdout as the
 * response body. Throws on non-zero exit, timeout, or non-JSON output — the
 * caller turns that into a 500.
 */
export async function runStateShim(opts: RunStateShimOptions): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const env = {
    ...process.env,
    ABACUS_PRODUCT: opts.product.name,
    ABACUS_HTTP_QUERY: JSON.stringify(opts.request.query),
  };

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const child = spawn('bash', ['-c', opts.handler.preScript], {
    cwd: opts.product.dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, timeoutMs);

  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('close', (code) => resolvePromise(code));
  });
  clearTimeout(timer);

  const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

  if (exitCode !== 0) {
    throw new Error(
      `state-shim: ${opts.product.name} exited ${exitCode}${
        stderr ? ` — ${stderr.slice(0, 500)}` : ''
      }`,
    );
  }
  if (!stdout) {
    throw new Error(
      `state-shim: ${opts.product.name} produced no stdout${
        stderr ? ` (stderr: ${stderr.slice(0, 500)})` : ''
      }`,
    );
  }

  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `state-shim: ${opts.product.name} wrote non-JSON stdout: ${(err as Error).message}`,
    );
  }
}
