import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from './config.js';

// Walk up from this module (packages/abacus/{src|dist}/main.{ts|js}) to the
// repo root; load .env.local from there. Also honor cwd overrides.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });
loadDotenv({ path: resolve(repoRoot, '.env') });
loadDotenv({ path: resolve(process.cwd(), '.env.local') });
process.env.ABACUS_PACKAGES_DIR ??= resolve(repoRoot, 'packages');
import { Beads } from './beads.js';
import { Queue } from './queue.js';
import { Tmux } from './tmux.js';
import { SseBus } from './sse.js';
import { ClaudeRunner, DummyRunner, type Runner } from './runner.js';
import { ProductRegistry } from './product-registry.js';
import { Dispatcher } from './dispatcher.js';
import { buildServer } from './server.js';
import { initOtel } from './otel.js';

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const otel = initOtel({ runtimeDir: config.ABACUS_RUNTIME_DIR });
  const beads = new Beads();
  const queue = new Queue(beads, config.ABACUS_DEDUPE_TTL_SECONDS);
  const tmux = new Tmux();
  const sse = new SseBus();
  sse.startHeartbeat(15_000);

  const registry = await ProductRegistry.load(config.ABACUS_PACKAGES_DIR);
  let runner: Runner;
  if (config.ABACUS_RUNNER === 'dummy') {
    runner = new DummyRunner();
  } else {
    runner = new ClaudeRunner({
      beads,
      registry,
      corePath: resolve(config.ABACUS_PACKAGES_DIR, 'abacus', '.claude.json'),
    });
  }

  const dispatcher = new Dispatcher({
    queue,
    tmux,
    sse,
    runner,
    runtimeDir: config.ABACUS_RUNTIME_DIR,
    pollIntervalMs: config.ABACUS_POLL_INTERVAL_MS,
    maxWallclockSeconds: config.ABACUS_WATCHDOG_WALLCLOCK_SECONDS,
    logger: (msg, extra) =>
      console.error(JSON.stringify({ msg, ...(extra ?? {}), ts: new Date().toISOString() })),
  });

  const app = await buildServer({
    queue,
    sse,
    registry,
    runtimeDir: config.ABACUS_RUNTIME_DIR,
    logger: config.ABACUS_HTTP_LOG,
    corsOrigins: config.ABACUS_CORS_ORIGINS,
    stateShimTimeoutMs: config.ABACUS_STATE_SHIM_TIMEOUT_MS,
  });

  dispatcher.start();
  await app.listen({ host: config.ABACUS_HOST, port: config.ABACUS_PORT });
  console.error(
    JSON.stringify({
      msg: 'abacus.ready',
      host: config.ABACUS_HOST,
      port: config.ABACUS_PORT,
      otelSpans: otel.spansFile,
    }),
  );

  const shutdown = async (): Promise<void> => {
    await dispatcher.stop();
    sse.closeAll();
    await app.close();
    await otel.shutdown();
  };
  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  bootstrap().catch((err) => {
    console.error(JSON.stringify({ msg: 'abacus.fatal', err: String(err) }));
    process.exit(1);
  });
}
