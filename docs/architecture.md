# Architecture

> Module map and boundaries. Updated every time a module is added, split, or renamed.
> If this document contradicts the code, the code is right and this doc is a bug —
> fix the doc in the same change that caused the drift.

## Monorepo layout

```
/
├── packages/
│   ├── abacus/                      # Platform — product-agnostic orchestrator
│   │   ├── src/                     # TypeScript sources (M1+M2 landed)
│   │   ├── scripts/                 # Package-local scripts (smoke tests)
│   │   ├── core-tools/              # Agent-callable infra scripts (doctor, rotate-logs, reap-tmux-orphans)
│   │   ├── .claude.json             # Platform MCP config (no abacus.json — that's what makes this NOT a product)
│   │   └── claude.md                # Platform runtime constitution
│   └── marathon/                    # Product #1 — Marathon Planner
│       ├── scripts/                 # Deterministic ZFC scripts (M3+) incl. state shim
│       ├── mcp-servers/             # MCP tools for the agent (M3+)
│       ├── dashboard/               # Product-scoped Next.js UI (M4)
│       ├── .claude.json             # Product MCP config
│       ├── abacus.json              # Platform-scoped manifest (hot-memory, tasks, webhooks, state)
│       ├── claude.md                # Product runtime constitution
│       └── .platform-denylist       # Tokens platform code must never contain
├── docs/
│   ├── spec.md                      # Living product + technical spec
│   ├── architecture.md              # This file
│   ├── runbook.md                   # Operate / debug the running system
│   └── adr/                         # Append-only architectural decisions (dated)
├── scripts/
│   └── doctor.sh                    # Preflight: verifies bd / dolt / tmux / claude / node / pnpm
└── [root config]                    # package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint, prettier, .env.example
```

## Platform vs products — the single most important boundary

Abacus (`packages/abacus/`) is the reusable platform. Products live in `packages/<name>/`.
The boundary is load-bearing and enforced by CI:

- **Platform code knows nothing about any product domain.** The `.platform-denylist` in each product lists tokens that must not appear in `packages/abacus/src/`. Marathon's list is intentionally narrow — only unambiguous domain words (`marathon`, `strava`, `workout`, `effort`, `pace`, `training`, `overtraining`); generic words like `runner` or `race` are excluded because they have legitimate platform meanings (task runner, race condition).
- **Products depend on platform via public exports only.** The API surface is whatever `packages/abacus/src/index.ts` exports — never reach into internals.
- **Products don't know about each other.** `packages/marathon/` never imports from `packages/<other-product>/`.
- **Products are discovered by convention.** `mcp-host.ts` scans `packages/*/` for any directory containing all three marker files: `claude.md`, `.claude.json`, and `abacus.json`. The platform's own package omits `abacus.json`, so it isn't discovered as a product. No platform-side registry exists; adding a product means creating a directory.
- **CI enforces the boundary** via two lints in `scripts/`: `lint-zfc.ts` (forbids payload-content branching in `packages/abacus/src/`) and `lint-platform-purity.ts` (greps every product's `.platform-denylist` against platform code). Run via `pnpm -w run lint`.

## Module responsibilities (filled in as code lands)

### Platform (`packages/abacus/src/`, M1+)

| File            | Role                                                                                  | Status |
| --------------- | ------------------------------------------------------------------------------------- | ------ |
| `server.ts`     | Fastify: `/invoke`, `/events` (SSE), `/tasks`, `/task/:id/stream`, `/webhook/:src`    | M1 ✅  |
| `queue.ts`      | Task queue over `platform:agent-task` Beads issues; dedupe by key within TTL          | M1 ✅  |
| `dispatcher.ts` | Single-claimer poll loop; spawns tmux, arms watchdog, awaits `exit.code`              | M1 ✅  |
| `tmux.ts`       | `execFile`-based wrapper: `spawn`, `kill`, `exists` with exact-name match             | M1 ✅  |
| `watchdog.ts`   | Wall-clock cap (iteration + token caps layer in M3 with the real runner)              | M1 ✅  |
| `sse.ts`        | Per-product channels + 15s heartbeat (`reply.hijack()` for Fastify raw writes)        | M1 ✅  |
| `runner.ts`     | `Runner` interface; `DummyRunner` (test); `ClaudeRunner` (M3) renders per-task wrapper | M3 ✅  |
| `beads.ts`      | `execFile` wrapper over `bd` CLI: `create`, `list`, `show`, `updateMetadata`, `close` | M1 ✅  |
| `config.ts`     | Env loader with zod schema (ABACUS\_\* knobs; `.env.local` honored)                   | M1 ✅  |
| `types.ts`      | Zod schemas for every boundary payload (`ProductName`, `TaskKind`, `TaskHandler`, …)  | M3 ✅  |
| `main.ts`       | `bootstrap()`: wires config → beads → queue → tmux → sse → dispatcher → server        | M1 ✅  |
| `index.ts`      | Public platform exports consumed by products                                          | M1 ✅  |
| `memory.ts`     | Hot-memory loader (per-product manifest) + cold-memory SELECT-only Dolt query         | M2 ✅  |
| `mcp-host.ts`   | Product discovery by convention + MCP config merge                                    | M2 ✅  |
| `product-registry.ts` | In-memory cache of discovered products; resolves per-(product, kind) handlers + webhook handlers | M3 ✅  |
| `webhook-shim.ts`     | Spawns a product's webhook shim subprocess, parses JSON action, returns it      | M3b ✅ |
| `state-shim.ts`       | Spawns a product's state-read shim subprocess, returns raw JSON                 | M4 ✅  |
| `secrets.ts`          | Webhook-token verifier (env lives in `config.ts`)                               | later  |
| `otel.ts`             | OTel bootstrap (JSONL file exporter + optional OTLP HTTP) + `withSpan`/traceparent helpers | M5 ✅  |

### Marathon product (`packages/marathon/`, M3)

| Path                                 | Role                                                                                          | Status |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ------ |
| `lib/types.ts`                       | Marathon domain zod schemas + type-label constants                                            | M3 ✅  |
| `scripts/seed-plan.ts`               | Deterministic CLI: 1 plan + N week-blocks + 7N workouts written to Beads                      | M3 ✅  |
| `scripts/fetch-and-store-strava.ts`  | Mechanical: Strava API call → `marathon:strava-activity` Beads issue (offline mode supported) | M3 ✅  |
| `scripts/ingest-perceived-effort.ts` | Mechanical: validate slider input → `marathon:effort-log` issue                               | M3 ✅  |
| `mcp-servers/training-plan/`         | MCP tools the agent calls: `get_plan`, `update_workout`, `query_history`, `flag_overtraining` | M3 ✅  |
| `scripts/strava-onboard.ts`          | One-shot Strava OAuth; writes refresh token to `.env.local`                                   | M3b ✅ |
| `scripts/strava-subscribe.ts`        | CLI to create / list / delete Strava webhook push-subscriptions                               | M3b ✅ |
| `scripts/strava-webhook-shim.ts`     | Webhook shim: handles hub.challenge GET handshake + transforms POSTs into `enqueue` actions   | M3b ✅ |
| `scripts/get-state.ts`               | State-read shim: returns JSON view of plan + current week + recent efforts/activities/flags   | M4 ✅  |
| `dashboard/`                         | Next.js App Router UI (App Router, React 19, Tailwind 3). Reads `/api/marathon/state`, invokes via `/api/marathon/invoke`, subscribes to `/api/marathon/events` | M4 ✅  |

### Product-scoped dashboards (M4)

Dashboards live **inside their product** at `packages/<product>/dashboard/`, not
under a top-level `apps/` directory. This preserves platform/product separation:
each product ships its own UI and domain-shaped reads; the platform hosts none.

Reads flow through a new per-product shim. A product declares `state.preScript`
in its `abacus.json`; `GET /api/:product/state` spawns that subprocess with
`ABACUS_PRODUCT` and `ABACUS_HTTP_QUERY` (JSON) in the env and returns stdout
verbatim as `application/json`. Writes continue to flow through `POST
/api/:product/invoke`. Dashboards subscribe to `/api/:product/events` via SSE
and refetch state on `TASK_COMPLETE` / `TASK_FAILED`. See
`docs/adr/0002-product-scoped-dashboards-and-state-shim.md`.

## Data layer

Single store: **Beads** (`bd` CLI), which sits on **Dolt** under the hood. Dolt gives
us git-for-data branching for future CI scenarios.

Types are namespaced:

- `platform:<kind>` — platform-owned. Currently `platform:agent-task` (queue row / audit).
- `<product>:<kind>` — product-owned. Marathon owns `marathon:training-plan`, `marathon:week-block`, `marathon:workout`, `marathon:strava-activity`, `marathon:effort-log`.

Hot-memory definitions live in each product's `abacus.json` under the `hotMemory` key
(types, window, status filter, max items). Platform code never hardcodes which types
belong to which product — it reads the manifest and queries Beads accordingly.

Cold memory is exposed to the agent as the `query_history` MCP tool: a SELECT-only
SQL query against the Dolt database that backs Beads. The platform validates SELECT-
only at the boundary and applies a row limit; the agent gets raw rows back.

## Runtime

- `abacus` (Fastify) — port 3001 — accepts REST/webhook/SSE traffic, manages the task queue and tmux sessions. CORS for dashboards is controlled by `ABACUS_CORS_ORIGINS` (default: `http://localhost:3000,http://127.0.0.1:3000`).
- Product dashboards (Next.js) — port 3000 — SSR/CSR UIs, one per product, packaged at `packages/<product>/dashboard/`.
- Agent sessions — detached `tmux` named `abacus-<task_id>`, running `claude -p --output-format json --mcp-config <resolved>`. Logs piped to `runtime/logs/<task_id>.log`.
- OTel — JSONL spans written to `runtime/otel/spans-<ts>.jsonl` (always on); OTLP HTTP exporter added when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Trace context propagates `server → dispatcher` via a `traceparent` field on the queue row's Beads metadata.

## References

- Repo tenets: `/CLAUDE.md`
- Spec: `/docs/spec.md`
- Runbook: `/docs/runbook.md`
- ADRs: `/docs/adr/`
- Plan: `/Users/alexjansen/.claude/plans/product-technical-specificationproject-hazy-neumann.md`
