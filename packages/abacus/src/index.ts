export { loadConfig, type Config } from './config.js';
export { Beads, type BdIssue, type BeadsOptions } from './beads.js';
export { Queue, type EnqueueResult } from './queue.js';
export { Tmux } from './tmux.js';
export { Watchdog, type WatchdogArm, type WatchdogReason } from './watchdog.js';
export { SseBus } from './sse.js';
export { Dispatcher, type DispatcherDeps } from './dispatcher.js';
export {
  ClaudeRunner,
  DummyRunner,
  type ClaudeRunnerOptions,
  type Runner,
  type RunnerContext,
  type PreparedRunner,
} from './runner.js';
export { ProductRegistry } from './product-registry.js';
export { buildServer, type ServerDeps } from './server.js';
export {
  loadHotMemory,
  coldMemoryQuery,
  coldMemoryToolSpec,
  type HotMemorySnapshot,
  type ColdMemoryOptions,
} from './memory.js';
export { discoverProducts, resolveMcpConfig, type ResolveMcpOptions } from './mcp-host.js';
export {
  runWebhookShim,
  type RunShimOptions,
  type WebhookRequest,
} from './webhook-shim.js';
export {
  runStateShim,
  type RunStateShimOptions,
  type StateRequest,
} from './state-shim.js';
export {
  AgentTask,
  ClaudeConfig,
  DiscoveredProduct,
  HotMemoryPolicy,
  InvokeRequest,
  InvokeResponse,
  McpServerSpec,
  ProductManifest,
  ProductName,
  SseEvent,
  StateHandler,
  TaskHandler,
  TaskKind,
  TaskStatus,
  WebhookAction,
  WebhookHandler,
  WebhookParams,
} from './types.js';

export const VERSION = '0.1.0';
