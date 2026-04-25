/**
 * OpenTelemetry bootstrap for the platform. Two exporters by default:
 *   1. JSONL file exporter — always on, writes one JSON object per line to
 *      `<runtimeDir>/otel/spans-<startedAt>.jsonl`. Zero-infra and trivially
 *      grep-able for tests.
 *   2. OTLP HTTP exporter — opt-in. Active iff `OTEL_EXPORTER_OTLP_ENDPOINT`
 *      is set. Lets you point at Jaeger / Tempo / etc. without code changes.
 *
 * The platform never reads spans back. Trace context propagation across the
 * (server → queue → dispatcher) boundary is via `traceparent` written to the
 * task's Beads metadata at enqueue time and re-extracted at claim time.
 */
import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  trace,
  context,
  propagation,
  SpanStatusCode,
  type Tracer,
  type Span,
  type Context,
  type Attributes,
} from '@opentelemetry/api';
import {
  SimpleSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { W3CTraceContextPropagator, type ExportResult } from '@opentelemetry/core';

class JsonlFileExporter implements SpanExporter {
  private stream: WriteStream;
  constructor(filePath: string) {
    mkdirSync(resolve(filePath, '..'), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: 'a' });
  }
  export(spans: ReadableSpan[], cb: (result: ExportResult) => void): void {
    try {
      for (const s of spans) {
        const ctx = s.spanContext();
        this.stream.write(
          `${JSON.stringify({
            name: s.name,
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            parentSpanId: s.parentSpanId,
            kind: s.kind,
            startTime: s.startTime,
            endTime: s.endTime,
            durationNs: s.duration[0] * 1e9 + s.duration[1],
            status: s.status,
            attributes: s.attributes,
            events: s.events,
          })}\n`,
        );
      }
      cb({ code: 0 });
    } catch (err) {
      cb({ code: 1, error: err as Error });
    }
  }
  async shutdown(): Promise<void> {
    await new Promise<void>((r) => this.stream.end(r));
  }
}

export interface OtelHandle {
  tracer: Tracer;
  shutdown: () => Promise<void>;
  spansFile: string;
}

const TRACER_NAME = 'abacus.platform';

let handle: OtelHandle | null = null;

export function initOtel(opts: { runtimeDir: string }): OtelHandle {
  if (handle) return handle;
  if (process.env.OTEL_DISABLE === '1') {
    handle = {
      tracer: trace.getTracer(TRACER_NAME),
      shutdown: async () => {},
      spansFile: '',
    };
    return handle;
  }

  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const spansFile = join(resolve(opts.runtimeDir), 'otel', `spans-${startedAt}.jsonl`);

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'abacus',
    }),
    spanProcessors: [new SimpleSpanProcessor(new JsonlFileExporter(spansFile))].concat(
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? [new SimpleSpanProcessor(new OTLPTraceExporter())]
        : [],
    ),
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });

  const tracer = trace.getTracer(TRACER_NAME);
  handle = {
    tracer,
    spansFile,
    shutdown: async () => {
      await provider.shutdown();
    },
  };
  return handle;
}

export function tracer(): Tracer {
  return (handle?.tracer ?? trace.getTracer(TRACER_NAME));
}

/**
 * Run `fn` inside a child span. Propagates exceptions and records them on the
 * span. The span is ended even on throw. The active context is set so any
 * spans created inside `fn` parent to this one automatically.
 */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer().startSpan(name, { attributes: attrs });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    throw err;
  } finally {
    span.end();
  }
}

/** Serialize the active context as a `traceparent` header string. */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

/**
 * Run `fn` in a context restored from a `traceparent` header. New spans
 * created inside will be children of the original trace. Used by the
 * dispatcher to continue the trace started by the HTTP layer.
 */
export async function withTraceparent<T>(
  traceparent: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!traceparent) return fn();
  const ctx: Context = propagation.extract(context.active(), { traceparent });
  return context.with(ctx, fn);
}
