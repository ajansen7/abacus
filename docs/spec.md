# Abacus — product & technical specification

> Source: authored by the user at project kickoff (April 2026). Living document — update
> in the same change that alters observable behavior. Never delete history; supersede
> outdated sections with dated notes and move prior decisions into `docs/adr/`.

## 1. Executive summary

**Abacus** is a locally hosted, remotely accessible orchestration framework designed to
manage headless agentic workflows. It serves as an agnostic engine that handles API
routing, webhook listening, and cross-session memory management using a single
graph-database solution (Beads).

On top of this framework, an open-ended set of **products** is planned. The first product
— and the platform's PoC — is a **Marathon Planning Tool**: a mobile-friendly web app that
reacts to user inputs (perceived effort) and external events (Strava activity webhooks).
By adhering to strict "Zero Framework Cognition" (ZFC) principles, the system acts as a
thin, safe, deterministic shell for data ingestion and routing, while dynamically spinning
up isolated Claude Code sessions to handle 100% of the reasoning about fatigue, performance
evaluation, and training-plan adjustments.

Already articulated as future products on this platform: interactive family weekly
planner, weekly meal planner, trip planner (replacing an older Claude Desktop artifact
workflow).

## 2. Abacus — framework architecture

Abacus acts as an API gateway, a process dispatcher, a memory router, and a security
enforcer. It remains completely ignorant of product-specific logic.

### 2.1 System components

- **API & Communications Gateway** — unified REST API for UI clients; webhook listener; SSE channels pushing real-time state updates to connected UIs; continuous bi-directional channels (e.g., Telegram bot — not yet shipped) for conversational mobile interaction.
- **Security & Auth Layer** — lightweight plug-and-play identity provider (SQLite-backed JWT sessions — not yet shipped; only needed once exposed beyond Tailscale/localhost); central secrets vault for API keys and webhook-token verification.
- **Self-Healing Task Queue** — concurrency, state tracking (`pending`, `running`, `completed`, `failed`), retries, dedupe by `dedupe_key` within a TTL.
- **Task Orchestrator & Circuit Breaker** — consumes queue jobs, spawns detached `tmux` sessions, enforces iteration / wall-clock / token caps via a watchdog.
- **Two-Tier Memory Engine (Beads / Dolt)** — hot memory auto-injected into prompts; cold memory accessed on-demand via a `query_history(sql)` MCP tool.

### 2.2 Standardized skill loading (MCP integration)

Abacus is an MCP host. Each product declares skills as localized MCP servers. Product
discovery is by convention: `mcp-host.ts` scans `packages/*/` for directories containing
both `claude.md` and `.claude.json`.

```
/packages/
├── abacus/                  # The platform
│   ├── .claude.json         # Platform-level MCP config
│   ├── claude.md            # Platform constitution
│   ├── core-tools/          # Infrastructure maintenance scripts (agent-callable)
│   └── src/
└── <product>/               # Any product — marathon is product #1
    ├── .claude.json         # Product MCP config
    ├── claude.md            # Product constitution
    ├── scripts/             # Deterministic local scripts (no reasoning)
    └── mcp-servers/         # MCP tools used by the product's agent session
```

### 2.3 Zero Framework Cognition (ZFC) philosophy

Abacus is pure orchestration and delegates all reasoning to the external AI. It is a
"thin, safe, deterministic shell" around AI reasoning with strong guardrails and
observability.

**Allowed in platform code and deterministic scripts:**

- Pure orchestration and IO: file reads/writes, JSON parsing, webhook handling, Beads interaction.
- Structural safety: zod schema validation, timeout enforcement, cancellation.
- Policy enforcement: budget caps, token limits, auth/permission checks.
- State management: task lifecycle, logging, SSE events.

**Forbidden in platform code and deterministic scripts:**

- Local intelligence: heuristic scoring, content-based classification, quality judgement.
- Composition logic: ordering/parallelization decisions, semantic retry loops.
- Heuristic classification or keyword-based routing.

**The ZFC execution flow** — every event follows exactly four phases:

1. **Gather raw context** (IO only) — Abacus captures the webhook/event and retrieves Hot Memory from Beads.
2. **Call AI for decisions** — hand context to a detached Claude Code session in `tmux`.
3. **Validate structure** — zod-check every MCP tool call and enforce policy.
4. **Execute mechanically** — apply the AI's decisions without modification.

### 2.4 Context imprinting

Every package leverages a `claude.md` at its root. Claude Code natively ingests this file.
It is the agent's constitution: boundaries, Hot vs Cold memory workflow, product
heuristics. Because platform code holds no heuristics, product `claude.md` files are
where all domain judgement lives.

## 3. Product architecture — Marathon Planner PoC

### 3.1 UX & real-time UI

- Dashboard shows the current week's training plan and historical metrics.
- Opinionated inputs (a slider for perceived effort).
- Real-time reactivity via SSE (`/api/:product/events`): when the orchestrator finishes a task and updates Beads, it pushes a `TASK_COMPLETE` event and the UI refetches.

### 3.2 Event-driven workflow (Strava example)

1. **Trigger** — Strava POSTs to `/api/marathon/webhook/strava`.
2. **Security & queue** — Abacus verifies `subscription_id`, dedupes, enqueues a `process_activity` task.
3. **Step 1 (ZFC IO)** — `packages/marathon/scripts/fetch-and-store-strava.ts` mechanically calls the Strava API and stores the raw JSON in Beads.
4. **Step 2 (ZFC AI)** — the orchestrator invokes the agent: _"Activity saved. Review against this week's workouts in Hot Memory. Fetch Cold Memory if this resembles past overtraining patterns. If tomorrow's plan needs adjustment, update it."_
5. **Steps 3 & 4 (ZFC validate + execute)** — the agent reasons via MCP tools; Abacus schema-checks each call, applies the DB update, and emits a `TASK_COMPLETE` SSE event.

## 4. API contracts

- `POST /api/:product/invoke` → enqueue a task; returns `task_id`.
- `GET /api/:product/events` → Server-Sent Events for UI refresh notifications.
- `GET /api/:product/task/:task_id/stream` → tails the tmux log file ("thinking" view).
- `GET /api/:product/state` → current product state (forwards to the product's `get_state` handler).
- `POST /api/:product/webhook/:source` → generic webhook intake.

## 5. Engineering standards (build-time)

- **Security-first** — auth validation and secrets management are implemented natively; never mocked.
- **Modular & DRY** — duplication is strictly prohibited; existing utilities are leveraged.
- **Clean interfaces** — products interact with Abacus strictly via defined REST/queue/MCP interfaces and its public TypeScript exports. No internal reaches.
- **Self-documenting** — modifications require concurrent updates to the relevant `claude.md`, `README.md`, or `docs/` entries.

## 6. Developer experience, testing & observability

- **"God Mode" debugger** — `tmux attach -t <task_id>` drops into a live agent session.
- **OpenTelemetry tracing** — every task emits a single structured trace tree (`task.received → task.settled → {runner.prepare, memory.loaded, tmux.spawned}`); a JSONL exporter writes spans to `runtime/otel/`, and setting `OTEL_EXPORTER_OTLP_ENDPOINT` adds OTLP HTTP export. Decisions remain auditable after the tmux session closes.
- **Agentic CI/CD via Dolt branches** — not yet shipped. Dolt's git-for-data support lets us create `test/<topic>` branches where an agent can mutate the DB, then `dolt diff` verifies behavior before merging.
- **Dual-mode execution** — not yet shipped. A `--build` flag reconfigures Claude Code as a software engineer to help extend Abacus itself.

## 8. Marathon — race-driven plan lifecycle

*(Added 2026-04-25 — supersedes the simpler "seed-plan + forward-only Strava" description in §3.)*

### 8.1 Entity model

```
marathon:race            raceId, name, date, distance, location?, goalFinishTime?
marathon:training-plan   planId, raceId?, raceDate, startDate, weeks, templateId?, goalPace?
marathon:plan-context    planContextId, planId, notes, updatedAt
marathon:week-block      weekBlockId, planId, weekIndex, theme, startDate
marathon:workout         workoutId, weekBlockId, date, kind, targetDurationMin, actual?
marathon:strava-activity activityIssueId (wraps raw Strava JSON or manual entry)
marathon:effort-log      workoutId, score (RPE 1–10), notes?
marathon:flag            reason, severity, raisedAt
```

`workout.actual` sub-object: `{ activityId?, activityKind, source, deviationStatus, durationMin?, notes? }`.
`deviationStatus` ∈ `met | partial | swapped | skipped | extra` (see ADR-0003).

### 8.2 Plan-creation flow

1. User submits race + start date + steering context via `/plan/new`.
2. `create-plan-shim.ts` (ZFC IO only) creates `marathon:race`, `marathon:training-plan` (shell — no workouts yet), and `marathon:plan-context`, then enqueues `backfill_strava` + `generate_plan` in sequence.
3. `backfill-strava.ts` fetches all Strava activities since `startDate` and writes them as `marathon:strava-activity` issues (idempotent by `activityId`).
4. `generate_plan` Claude session reads plan-context, reads templates via `list_templates`/`read_template`, picks the closest fit, and populates the plan via `create_week_block` + `create_workout` MCP calls.

### 8.3 Activity reconciliation flow

On every Strava webhook delivery (and on manual add/delete/reassign):

1. `process_activity` Claude session finds the workout matching the activity's local date.
2. Calls `set_workout_actual` with `deviationStatus` per `claude.md` rules.
3. For `swapped` or `skipped`, adjusts rest-of-current-week + next-week workouts via `update_workout` (scope: day+0 to day+14 only).
4. Calls `flag_overtraining` if overreach heuristics apply.

### 8.4 Daily re-evaluation

`daily_reeval` Claude session (triggered by launchd at 06:00 or manually):

- Re-reads plan-context (may have changed since last run).
- Surveys last 7 days of workouts and activities.
- Adjusts rest-of-current-week + next-week workouts if constraints have changed (new injury, schedule shift).
- Scope: day+0 to day+14 only. Full re-plan is out of scope for this task.

### 8.5 Deviation status state diagram

```
(no actual) ──── Strava activity arrives or manual add ──→ met | partial | swapped | extra
(no actual) ──── date passes with no activity ───────────→ skipped
met | partial | swapped | skipped | extra ─── manual delete ──→ (no actual, completed: false)
any ─── manual reassign ──→ re-runs reconciliation ──→ new status
```

## 7. Explicit non-goals (for now)

Telegram bot, `--build` SWE-persona mode, JWT auth layer, Dolt-branch-based test
CI, and per-tool `agent.tool_call` child OTel spans (the last needs claude
output streaming first). Each slots into existing seams when the time comes;
none are blocked by the current shape.
