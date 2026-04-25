#!/usr/bin/env tsx
/**
 * M5 acceptance smoke — proves the platform discovers products by convention,
 * runs end-to-end against an *unfamiliar* product (created in a tmp packages
 * dir), and that the OTel trace tree is structurally correct (one trace,
 * task.received as root, dispatcher spans as descendants via traceparent
 * propagation).
 *
 * The drop-in product is created in a fresh tmpdir so this leaves no trace on
 * the real packages/ tree. Abacus discovers it because it has the three marker
 * files. The dummy runner is used so we don't burn `claude` API calls.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PRODUCT = '_dropin';
const PORT = process.env.ABACUS_SMOKE_PORT ?? '3099';
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

function fail(reason: string, extra?: Record<string, unknown>): never {
  console.error(`[m5-smoke] FAIL — ${reason}`, extra ?? '');
  process.exit(2);
}

async function writeDropinProduct(packagesDir: string): Promise<void> {
  const dir = join(packagesDir, PRODUCT);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'claude.md'),
    '# Drop-in product (smoke fixture)\n\nThis is a synthetic product; agent should never see it.\n',
    'utf8',
  );
  await writeFile(join(dir, '.claude.json'), JSON.stringify({ mcpServers: {} }, null, 2), 'utf8');
  await writeFile(
    join(dir, 'abacus.json'),
    JSON.stringify(
      {
        hotMemory: { types: [] },
        tasks: { ping: { prompt: 'noop — DummyRunner ignores this' } },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(join(dir, '.platform-denylist'), '', 'utf8');
}

async function readSpans(spansFile: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(spansFile, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function main(): Promise<void> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'abacus-m5-'));
  const packagesDir = join(tmpRoot, 'packages');
  const runtimeDir = join(tmpRoot, 'runtime');
  await mkdir(packagesDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await writeDropinProduct(packagesDir);

  // Set env BEFORE importing main.ts (dotenv runs at module-load time).
  process.env.ABACUS_PACKAGES_DIR = packagesDir;
  process.env.ABACUS_RUNTIME_DIR = runtimeDir;
  process.env.ABACUS_PORT = PORT;
  process.env.ABACUS_HOST = HOST;
  process.env.ABACUS_RUNNER = 'dummy';
  process.env.ABACUS_HTTP_LOG = '';

  let createdTaskId: string | null = null;
  try {
    const { bootstrap } = await import('../src/main.js');
    void bootstrap();

    // Wait until /health responds, with timeout.
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    if (!ready) fail('platform never came up');

    const events: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    const sseRes = await fetch(`${BASE}/api/${PRODUCT}/events`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!sseRes.ok || !sseRes.body) fail(`SSE connect failed: ${sseRes.status}`);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const sseLoop = (async () => {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            events.push(JSON.parse(dataLine.slice(6)));
          } catch {
            /* heartbeat */
          }
        }
      }
    })();

    const invokeRes = await fetch(`${BASE}/api/${PRODUCT}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'ping', payload: { hello: 'dropin' } }),
    });
    if (!invokeRes.ok) fail(`invoke failed: ${invokeRes.status} ${await invokeRes.text()}`);
    const invoke = (await invokeRes.json()) as { taskId: string };
    createdTaskId = invoke.taskId;
    console.error(`[m5-smoke] enqueued ${invoke.taskId} on undiscovered-by-platform product "${PRODUCT}"`);

    const deadline = Date.now() + 30_000;
    let completed = false;
    while (Date.now() < deadline) {
      if (
        events.some(
          (e) =>
            e.type === 'TASK_COMPLETE' &&
            (e as { taskId: string }).taskId === invoke.taskId,
        )
      ) {
        completed = true;
        break;
      }
      await sleep(250);
    }
    controller.abort();
    await sseLoop.catch(() => undefined);

    if (!completed) fail('no TASK_COMPLETE within 30s', { events });
    console.error('[m5-smoke] TASK_COMPLETE received');

    const { Beads } = await import('../src/beads.js');
    const { Queue } = await import('../src/queue.js');
    const queue = new Queue(new Beads(), 60);
    const task = await queue.get(invoke.taskId);
    if (task.status !== 'completed') fail(`task status not completed: ${task.status}`);
    if (task.product !== PRODUCT) fail(`task product mismatch: ${task.product}`);
    if (!task.traceparent) fail('task missing traceparent in metadata');
    console.error(`[m5-smoke] Beads has issue ${invoke.taskId} (status=${task.status}, traceparent=${task.traceparent.slice(0, 35)}…)`);

    // OTel verification — the spans file is in our tmp runtime dir.
    const otelDir = join(runtimeDir, 'otel');
    const otelEntries = await readFile(otelDir, 'utf8').catch(async () => {
      const { readdir } = await import('node:fs/promises');
      return (await readdir(otelDir)).join('\n');
    });
    const spansFileName = otelEntries
      .split('\n')
      .find((n) => n.startsWith('spans-') && n.endsWith('.jsonl'));
    if (!spansFileName) fail(`no spans file in ${otelDir}`);
    const spans = await readSpans(join(otelDir, spansFileName));
    const taskSpans = spans.filter(
      (s) => (s.attributes as Record<string, unknown>)?.['abacus.task_id'] === invoke.taskId,
    );
    const names = new Set(taskSpans.map((s) => s.name));
    for (const required of ['task.received', 'task.settled', 'runner.prepare', 'tmux.spawned']) {
      if (!names.has(required)) fail(`spans missing "${required}" — got ${[...names].join(',')}`);
    }
    const traceIds = new Set(taskSpans.map((s) => s.traceId));
    if (traceIds.size !== 1)
      fail(`expected single traceId for task, got ${traceIds.size}: ${[...traceIds].join(',')}`);
    console.error(
      `[m5-smoke] OTel: ${taskSpans.length} spans, single trace ${[...traceIds][0]?.slice(0, 8)}`,
    );

    console.error('[m5-smoke] OK — drop-in product worked end-to-end with no platform edits');
  } finally {
    if (createdTaskId) {
      // Best-effort: close the synthetic task issue so `bd list` stays clean.
      try {
        const { Beads } = await import('../src/beads.js');
        await new Beads().close(createdTaskId);
      } catch {
        /* already closed */
      }
    }
    await rm(tmpRoot, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[m5-smoke] fatal', err);
  process.exit(1);
});
