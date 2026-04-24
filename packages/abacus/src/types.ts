import { z } from 'zod';

export const ProductName = z
  .string()
  .min(1)
  .regex(
    /^[a-z_][a-z0-9-]*$/,
    'product must be lowercase alphanumeric with dashes (leading `_` reserved for test/internal)',
  );

export const TaskKind = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, 'kind must be lowercase snake_case');

export const TaskStatus = z.enum(['pending', 'running', 'completed', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const InvokeRequest = z.object({
  kind: TaskKind,
  payload: z.unknown(),
  dedupeKey: z.string().min(1).optional(),
});
export type InvokeRequest = z.infer<typeof InvokeRequest>;

export const InvokeResponse = z.object({
  taskId: z.string(),
  status: TaskStatus,
  dedupedFrom: z.string().optional(),
});
export type InvokeResponse = z.infer<typeof InvokeResponse>;

export const AgentTask = z.object({
  id: z.string(),
  product: ProductName,
  kind: TaskKind,
  payload: z.unknown(),
  status: TaskStatus,
  dedupeKey: z.string().optional(),
  tmuxSession: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  failureReason: z.string().optional(),
});
export type AgentTask = z.infer<typeof AgentTask>;

export const SseEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TASK_QUEUED'), taskId: z.string(), kind: TaskKind }),
  z.object({ type: z.literal('TASK_STARTED'), taskId: z.string(), tmuxSession: z.string() }),
  z.object({ type: z.literal('TASK_COMPLETE'), taskId: z.string() }),
  z.object({
    type: z.literal('TASK_FAILED'),
    taskId: z.string(),
    reason: z.string(),
  }),
  z.object({ type: z.literal('HEARTBEAT'), ts: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEvent>;

export const WebhookParams = z.object({
  product: ProductName,
  source: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/),
});
export type WebhookParams = z.infer<typeof WebhookParams>;

/**
 * Product manifest — lives at `packages/<product>/abacus.json`. Platform-defined
 * schema; the product authors the values. Keys listed here are what the platform
 * consumes — unknown keys are ignored so products can extend the file for their
 * own use.
 */
export const HotMemoryPolicy = z.object({
  types: z.array(z.string().min(1)).default([]),
  windowDays: z.number().int().positive().default(14),
  maxItems: z.number().int().positive().default(200),
  statusFilter: z.array(z.enum(['open', 'closed'])).default(['open']),
});
export type HotMemoryPolicy = z.infer<typeof HotMemoryPolicy>;

/**
 * A task handler describes how the dispatcher should execute one `kind` for a
 * product. Both fields are product-authored data; the platform never inspects
 * payload content to choose between handlers — selection is structural by
 * `(product, kind)`.
 *
 * - `preScript` — optional shell command run before the agent session. Treated
 *   as an opaque deterministic script. Inherits the product directory as cwd.
 *   Receives `ABACUS_TASK_ID`, `ABACUS_KIND`, `ABACUS_PAYLOAD` (JSON-encoded)
 *   in env. Must exit 0 to proceed.
 * - `prompt` — text passed to the agent session via `--print`. Supports
 *   `{{taskId}}`, `{{kind}}`, `{{payloadJson}}`, `{{hotMemoryJson}}` token
 *   substitution.
 */
export const TaskHandler = z
  .object({
    preScript: z.string().min(1).optional(),
    prompt: z.string().min(1),
  })
  .passthrough();
export type TaskHandler = z.infer<typeof TaskHandler>;

/**
 * Webhook shim — a product-owned subprocess the platform invokes for each
 * inbound request at `/api/:product/webhook/:source`. The shim decides the
 * response shape (direct response for handshakes, enqueue a task, or reject).
 * Platform stays blind to source-specific protocols; this lives in the
 * product because only the product knows the webhook's semantics.
 *
 * The shim is spawned with env:
 *   ABACUS_PRODUCT, ABACUS_SOURCE, ABACUS_HTTP_METHOD,
 *   ABACUS_HTTP_QUERY   — JSON object of query-string params
 *   ABACUS_HTTP_HEADERS — JSON object of request headers (lowercased keys)
 *   ABACUS_HTTP_BODY    — raw request body as a UTF-8 string
 *
 * It must exit 0 and write exactly one JSON object matching `WebhookAction` to
 * stdout. Non-zero exit or invalid output is a 500 back to the caller.
 */
export const WebhookHandler = z
  .object({
    preScript: z.string().min(1),
  })
  .passthrough();
export type WebhookHandler = z.infer<typeof WebhookHandler>;

export const WebhookAction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('respond'),
    status: z.number().int().min(100).max(599).default(200),
    body: z.string().default(''),
    contentType: z.string().default('text/plain; charset=utf-8'),
  }),
  z.object({
    kind: z.literal('enqueue'),
    taskKind: TaskKind,
    payload: z.unknown(),
    dedupeKey: z.string().min(1).optional(),
    status: z.number().int().min(100).max(599).optional(),
  }),
  z.object({
    kind: z.literal('reject'),
    status: z.number().int().min(400).max(599).default(400),
    reason: z.string().default('rejected'),
  }),
]);
export type WebhookAction = z.infer<typeof WebhookAction>;

/**
 * State shim — an optional product-owned subprocess the platform invokes for
 * `GET /api/:product/state`. Same spawn envelope as webhook shims but reads
 * only: it receives `ABACUS_PRODUCT` and `ABACUS_HTTP_QUERY` (JSON) in env
 * and must exit 0 with JSON on stdout. The platform returns that JSON
 * verbatim to the caller with `content-type: application/json`. Products use
 * this to expose their own domain-shaped reads without the platform naming
 * any domain concept.
 */
export const StateHandler = z
  .object({
    preScript: z.string().min(1),
  })
  .passthrough();
export type StateHandler = z.infer<typeof StateHandler>;

export const ProductManifest = z
  .object({
    hotMemory: HotMemoryPolicy.default({}),
    tasks: z.record(TaskKind, TaskHandler).default({}),
    webhooks: z.record(z.string().min(1), WebhookHandler).default({}),
    state: StateHandler.optional(),
  })
  .passthrough();
export type ProductManifest = z.infer<typeof ProductManifest>;

export const McpServerSpec = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
  .passthrough();
export type McpServerSpec = z.infer<typeof McpServerSpec>;

export const ClaudeConfig = z
  .object({
    mcpServers: z.record(McpServerSpec).default({}),
  })
  .passthrough();
export type ClaudeConfig = z.infer<typeof ClaudeConfig>;

export const DiscoveredProduct = z.object({
  name: ProductName,
  dir: z.string(),
  manifest: ProductManifest,
  mcpServers: z.record(McpServerSpec),
});
export type DiscoveredProduct = z.infer<typeof DiscoveredProduct>;
