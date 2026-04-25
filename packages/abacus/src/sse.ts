import type { FastifyReply } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import type { SseEvent } from './types.js';

interface Subscriber {
  id: number;
  reply: FastifyReply;
}

export class SseBus {
  private readonly channels = new Map<string, Map<number, Subscriber>>();
  private nextSubId = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const ts = new Date().toISOString();
      for (const product of this.channels.keys()) {
        this.publish(product, { type: 'HEARTBEAT', ts });
      }
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  subscribe(product: string, reply: FastifyReply): () => void {
    const preHijackHeaders: OutgoingHttpHeaders = {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    reply.hijack();
    reply.raw.writeHead(200, preHijackHeaders);
    reply.raw.write(': connected\n\n');

    const id = this.nextSubId++;
    const channel = this.channels.get(product) ?? new Map<number, Subscriber>();
    channel.set(id, { id, reply });
    this.channels.set(product, channel);

    const unsubscribe = (): void => {
      const ch = this.channels.get(product);
      ch?.delete(id);
      if (ch && ch.size === 0) this.channels.delete(product);
    };
    reply.raw.on('close', unsubscribe);
    return unsubscribe;
  }

  publish(product: string, event: SseEvent): void {
    const channel = this.channels.get(product);
    if (!channel) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of channel.values()) {
      try {
        sub.reply.raw.write(payload);
      } catch {
        channel.delete(sub.id);
      }
    }
  }

  closeAll(): void {
    for (const channel of this.channels.values()) {
      for (const sub of channel.values()) {
        try {
          sub.reply.raw.end();
        } catch {
          /* swallow */
        }
      }
    }
    this.channels.clear();
    this.stopHeartbeat();
  }
}
