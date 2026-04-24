import { setTimeout as sleep } from 'node:timers/promises';
import { bootstrap } from '../src/main.js';
import { Beads } from '../src/beads.js';
import { Queue } from '../src/queue.js';

const BASE = `http://${process.env.ABACUS_HOST ?? '127.0.0.1'}:${process.env.ABACUS_PORT ?? '3001'}`;
const PRODUCT = '_test';

async function main(): Promise<void> {
  const serverReady = bootstrap();
  await sleep(500);

  const events: unknown[] = [];
  const controller = new AbortController();
  const sseRes = await fetch(`${BASE}/api/${PRODUCT}/events`, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  });
  if (!sseRes.ok || !sseRes.body) {
    const body = await sseRes.text().catch(() => '<no body>');
    throw new Error(`SSE connect failed: ${sseRes.status} — ${body}`);
  }
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
          /* heartbeat comment */
        }
      }
    }
  })();

  const invokeRes = await fetch(`${BASE}/api/${PRODUCT}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'ping', payload: { hello: 'world' } }),
  });
  const invokeJson = (await invokeRes.json()) as { taskId: string };
  console.error('[smoke] enqueued', invokeJson);

  const deadline = Date.now() + 30_000;
  let completed = false;
  while (Date.now() < deadline) {
    if (
      events.some(
        (e) =>
          typeof e === 'object' &&
          e !== null &&
          'type' in e &&
          (e as { type: string; taskId?: string }).type === 'TASK_COMPLETE' &&
          (e as { type: string; taskId?: string }).taskId === invokeJson.taskId,
      )
    ) {
      completed = true;
      break;
    }
    await sleep(250);
  }
  controller.abort();
  await sseLoop.catch(() => undefined);

  if (!completed) {
    console.error('[smoke] FAIL — no TASK_COMPLETE within 30s', { events });
    process.exit(2);
  }

  const queue = new Queue(new Beads(), 60);
  const task = await queue.get(invokeJson.taskId);
  if (task.status !== 'completed') {
    console.error('[smoke] FAIL — task status in Beads:', task.status);
    process.exit(3);
  }

  console.error('[smoke] OK — task', invokeJson.taskId, 'completed; events:', events.length);

  process.exit(0);
  // eslint-disable-next-line no-unreachable
  await serverReady;
}

main().catch((err) => {
  console.error('[smoke] fatal', err);
  process.exit(1);
});
