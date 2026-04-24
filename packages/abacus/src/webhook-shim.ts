import { spawn } from 'node:child_process';
import type { DiscoveredProduct } from './types.js';
import { WebhookAction, WebhookHandler } from './types.js';

export interface WebhookRequest {
  method: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

export interface RunShimOptions {
  product: DiscoveredProduct;
  source: string;
  handler: WebhookHandler;
  request: WebhookRequest;
  /** Time budget for the subprocess. Default 10s. */
  timeoutMs?: number;
}

/**
 * Spawn a product's webhook shim and parse its JSON output into a structured
 * action. Throws if the subprocess exits non-zero, times out, or produces
 * invalid output — the caller turns that into a 500.
 */
export async function runWebhookShim(opts: RunShimOptions): Promise<WebhookAction> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const env = {
    ...process.env,
    ABACUS_PRODUCT: opts.product.name,
    ABACUS_SOURCE: opts.source,
    ABACUS_HTTP_METHOD: opts.request.method,
    ABACUS_HTTP_QUERY: JSON.stringify(opts.request.query),
    ABACUS_HTTP_HEADERS: JSON.stringify(opts.request.headers),
    ABACUS_HTTP_BODY: opts.request.body,
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
      `webhook-shim: ${opts.product.name}/${opts.source} exited ${exitCode}${
        stderr ? ` — ${stderr.slice(0, 500)}` : ''
      }`,
    );
  }
  if (!stdout) {
    throw new Error(
      `webhook-shim: ${opts.product.name}/${opts.source} produced no stdout${
        stderr ? ` (stderr: ${stderr.slice(0, 500)})` : ''
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `webhook-shim: ${opts.product.name}/${opts.source} wrote non-JSON stdout: ${(err as Error).message}`,
    );
  }

  const action = WebhookAction.safeParse(parsed);
  if (!action.success) {
    throw new Error(
      `webhook-shim: ${opts.product.name}/${opts.source} output failed schema: ${action.error.message}`,
    );
  }
  return action.data;
}
