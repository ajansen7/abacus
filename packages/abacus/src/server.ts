import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { ProductRegistry } from './product-registry.js';
import type { Queue } from './queue.js';
import type { SseBus } from './sse.js';
import { InvokeRequest, InvokeResponse, ProductName, TaskStatus, WebhookParams } from './types.js';
import { runStateShim } from './state-shim.js';
import { runWebhookShim } from './webhook-shim.js';

export interface ServerDeps {
  queue: Queue;
  sse: SseBus;
  runtimeDir: string;
  registry?: ProductRegistry;
  logger?: boolean;
  /** Comma-separated list of origins to allow, or `*` to allow any. */
  corsOrigins?: string;
}

const ProductParam = z.object({ product: ProductName });
const TaskParam = z.object({ product: ProductName, taskId: z.string().min(1) });

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  const runtimeDir = resolve(deps.runtimeDir);

  const corsRaw = deps.corsOrigins?.trim();
  if (corsRaw) {
    const origin =
      corsRaw === '*'
        ? true
        : corsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    await app.register(cors, { origin, credentials: true });
  }

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/api/:product/invoke', async (req, reply) => {
    const { product } = ProductParam.parse(req.params);
    const body = InvokeRequest.parse(req.body);
    const result = await deps.queue.enqueue({
      product,
      kind: body.kind,
      payload: body.payload,
      ...(body.dedupeKey ? { dedupeKey: body.dedupeKey } : {}),
    });
    if (!result.deduped) {
      deps.sse.publish(product, {
        type: 'TASK_QUEUED',
        taskId: result.task.id,
        kind: result.task.kind,
      });
    }
    const response: InvokeResponse = {
      taskId: result.task.id,
      status: result.task.status,
      ...(result.deduped ? { dedupedFrom: result.task.id } : {}),
    };
    await reply.send(response);
  });

  const handleWebhook = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = WebhookParams.parse(req.params);
    const handler = deps.registry?.webhookHandler(params.product, params.source);

    if (handler) {
      const rawBody =
        typeof req.body === 'string'
          ? req.body
          : req.body
            ? JSON.stringify(req.body)
            : '';
      const rawQuery = req.query as Record<string, unknown>;
      const queryFlat: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawQuery ?? {})) {
        queryFlat[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v.join(',');
      }
      const product = deps.registry!.require(params.product);
      let action;
      try {
        action = await runWebhookShim({
          product,
          source: params.source,
          handler,
          request: {
            method: req.method,
            query: queryFlat,
            headers,
            body: rawBody,
          },
        });
      } catch (err) {
        req.log.error({ err }, 'webhook shim failed');
        await reply.status(500).send({ error: 'shim_failure', message: (err as Error).message });
        return;
      }
      if (action.kind === 'respond') {
        reply.header('content-type', action.contentType);
        await reply.status(action.status).send(action.body);
        return;
      }
      if (action.kind === 'reject') {
        await reply.status(action.status).send({ error: 'rejected', reason: action.reason });
        return;
      }
      const result = await deps.queue.enqueue({
        product: params.product,
        kind: action.taskKind,
        payload: action.payload,
        ...(action.dedupeKey ? { dedupeKey: action.dedupeKey } : {}),
      });
      if (!result.deduped) {
        deps.sse.publish(params.product, {
          type: 'TASK_QUEUED',
          taskId: result.task.id,
          kind: result.task.kind,
        });
      }
      await reply.status(action.status ?? 202).send({ taskId: result.task.id });
      return;
    }

    const body = z
      .object({ kind: z.string().min(1), payload: z.unknown(), dedupeKey: z.string().optional() })
      .parse(req.body);
    const result = await deps.queue.enqueue({
      product: params.product,
      kind: body.kind,
      payload: body.payload,
      ...(body.dedupeKey ? { dedupeKey: body.dedupeKey } : {}),
    });
    if (!result.deduped) {
      deps.sse.publish(params.product, {
        type: 'TASK_QUEUED',
        taskId: result.task.id,
        kind: result.task.kind,
      });
    }
    await reply.status(202).send({ taskId: result.task.id });
  };

  app.post('/api/:product/webhook/:source', handleWebhook);
  app.get('/api/:product/webhook/:source', handleWebhook);

  app.get('/api/:product/state', async (req, reply) => {
    const { product } = ProductParam.parse(req.params);
    const handler = deps.registry?.stateHandler(product);
    if (!handler) {
      await reply.status(404).send({ error: 'no_state_handler', product });
      return;
    }
    const rawQuery = (req.query as Record<string, unknown>) ?? {};
    const queryFlat: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawQuery)) {
      queryFlat[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    try {
      const body = await runStateShim({
        product: deps.registry!.require(product),
        handler,
        request: { query: queryFlat },
      });
      await reply.header('content-type', 'application/json; charset=utf-8').send(body);
    } catch (err) {
      req.log.error({ err }, 'state shim failed');
      await reply.status(500).send({ error: 'shim_failure', message: (err as Error).message });
    }
  });

  app.get('/api/:product/events', (req, reply) => {
    const { product } = ProductParam.parse(req.params);
    deps.sse.subscribe(product, reply);
  });

  app.get('/api/:product/tasks', async (req) => {
    const { product } = ProductParam.parse(req.params);
    const status = z.object({ status: TaskStatus.optional() }).parse(req.query).status;
    const tasks = await deps.queue.list({
      product,
      ...(status ? { status } : {}),
    });
    return { tasks };
  });

  app.get('/api/:product/task/:taskId', async (req) => {
    const { taskId } = TaskParam.parse(req.params);
    return deps.queue.get(taskId);
  });

  app.get('/api/:product/task/:taskId/stream', async (req, reply) => {
    const { taskId } = TaskParam.parse(req.params);
    const logFile = join(runtimeDir, 'logs', `${taskId}.log`);
    try {
      await stat(logFile);
    } catch {
      await reply.status(404).send({ error: 'log_not_found' });
      return;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const stream = createReadStream(logFile);
    stream.pipe(reply.raw);
    reply.raw.on('close', () => stream.destroy());
  });

  return app;
}
