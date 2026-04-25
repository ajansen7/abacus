# Runbook

> How to bring Abacus up, poke at it while it's running, and recover from common
> failure modes. Grows with the system — at M0 it covers only the bootstrap.

## First-time setup

```bash
# From repo root
bash scripts/doctor.sh           # Verify bd, dolt, tmux, claude, node, pnpm
pnpm install                     # Install workspace dependencies
cp .env.example .env.local       # Fill in Strava creds, watchdog caps, OTLP endpoint
```

## Running the platform

```bash
pnpm --filter @abacus/platform dev     # Watch mode: tsx watch src/main.ts
pnpm --filter @abacus/platform start   # Built artifact: node dist/main.js
```

Fastify listens on `ABACUS_HOST:ABACUS_PORT` (default `127.0.0.1:3001`). HTTP request
logging is off by default — set `ABACUS_HTTP_LOG=1` to enable it.

### Runner selection

`ABACUS_RUNNER` controls which runner the dispatcher uses for spawned tasks:

- `dummy` (default) — writes a no-op bash script that echoes + sleeps + exits 0. Used for tests and the M1/M2 smokes.
- `claude` — the production runner. Looks up the per-(product, kind) handler from each product's `abacus.json`, runs the declared `preScript` for deterministic IO, then spawns `claude -p --output-format json --mcp-config <merged> --append-system-prompt <product/claude.md>` with the rendered prompt on stdin.

Set `ABACUS_RUNNER=claude` in `.env.local` once `claude` is on PATH and a product
declares the `(kind)` you intend to invoke.

### Marathon product — Strava onboarding + webhook subscription

One-time OAuth handshake (writes `STRAVA_REFRESH_TOKEN` to `.env.local`):

```bash
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-onboard.ts
```

Starts a local HTTP server on `127.0.0.1:43117`, prints an authorize URL, and
waits for the redirect callback. Strava app's "Authorization Callback Domain"
must be set to `localhost`.

Webhook subscription (needs the platform reachable from the public internet —
use `ngrok` or equivalent):

```bash
# 1. Start the platform with the real runner
ABACUS_RUNNER=claude pnpm --filter @abacus/platform dev

# 2. In another terminal, expose 3001
ngrok http 3001

# 3. Register the webhook with Strava (one subscription per app)
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts \
  --callback https://<ngrok-id>.ngrok.app/api/marathon/webhook/strava

# List / delete existing subscriptions
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --list
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --delete <id>
```

Strava performs the `hub.challenge` handshake the moment `--callback` is
registered; the platform routes the GET to `packages/marathon/scripts/strava-webhook-shim.ts`,
which validates `hub.verify_token` against `STRAVA_VERIFY_TOKEN` in
`.env.local` and echoes the challenge back. Any activity you then record on
Strava will POST to the same URL; the shim transforms it into an
`enqueue(process_activity)` action with a dedupe key of
`strava:<subscription_id>:<object_type>:<object_id>:<aspect_type>:<event_time>`.

### Marathon product — seeding a plan

```bash
pnpm --filter @abacus-products/marathon exec tsx scripts/seed-plan.ts \
  --weeks 4 --goal-pace 5:00 --race 2026-06-14
```

Writes 1 `marathon:training-plan` + 4 `marathon:week-block` + 28 `marathon:workout`
issues to Beads. Deterministic — re-run is additive (no upsert in v0; close the
old plan first if you want a clean slate).

### HTTP surface (M1)

| Route                                    | Purpose                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `POST /api/:product/invoke`              | Enqueue a task — returns `{ taskId, status }`        |
| `POST /api/:product/webhook/:source`     | Generic webhook intake (validates + enqueues)        |
| `GET  /api/:product/state`               | Product-owned read: spawns the `state` shim (M4)     |
| `GET  /api/:product/events`              | SSE stream of task lifecycle events for that product |
| `GET  /api/:product/tasks`               | List recent tasks for the product                    |
| `GET  /api/:product/task/:taskId`        | Fetch a single task                                  |
| `GET  /api/:product/task/:taskId/stream` | Tail the task's tmux log file                        |

## Smoke tests

```bash
pnpm --filter @abacus/platform smoke          # M1 — server + dispatcher + tmux end-to-end (DummyRunner)
pnpm --filter @abacus/platform smoke:m2       # M2 — discovery + memory + cold-query guard
pnpm --filter @abacus/platform smoke:m3       # M3 — ClaudeRunner.prepare wiring (no real claude spawn)
pnpm --filter @abacus/platform smoke:webhook  # M3b — webhook shim: handshake + enqueue + rejections
```

`smoke` boots the server in-process, subscribes to SSE, POSTs `/api/_test/invoke`,
and waits up to 30 s for a matching `TASK_COMPLETE` event + `completed` status in
Beads. `smoke:m2` exercises product discovery, MCP config resolution, the
hot-memory loader, and the SELECT-only guard on cold-memory queries. `smoke:m3`
calls `ClaudeRunner.prepare` against the real marathon product and asserts the
generated wrapper script, prompt, system prompt, and merged MCP config are all
well-formed (without spawning `claude`). All exit non-zero on any failure.

## Lints

```bash
pnpm -w run lint           # ZFC + platform-purity
pnpm -w run lint:zfc       # Forbids payload-content branching in packages/abacus/src/
pnpm -w run lint:purity    # Greps every product's .platform-denylist against platform code
```

Add `// zfc-allow` to a single line to exempt it from the ZFC lint (use sparingly).

## Core-tools (agent-callable maintenance)

```bash
pnpm --filter @abacus/platform doctor          # Verify bd, dolt, tmux, claude, node, pnpm in-process
pnpm --filter @abacus/platform rotate-logs     # Trim runtime/logs/ older than ABACUS_LOG_RETAIN_DAYS (14)
pnpm --filter @abacus/platform reap-orphans    # Kill abacus-* tmux sessions whose tasks are terminal/missing
```

## Running a product dashboard (M4)

Dashboards are product-scoped at `packages/<product>/dashboard/`. Each one is its
own pnpm workspace project. Start the platform first (so the `/api/:product/state`
and `/api/:product/events` endpoints exist), then run the dashboard in a second
terminal:

```bash
# Terminal 1 — platform
ABACUS_RUNNER=claude pnpm --filter @abacus/platform dev

# Terminal 2 — marathon dashboard on :3000
pnpm --filter @abacus-products/marathon-dashboard dev
```

The dashboard reads initial state via `GET /api/marathon/state`, submits effort
logs via `POST /api/marathon/invoke`, and subscribes to `/api/marathon/events`
(SSE). On `TASK_COMPLETE` / `TASK_FAILED` it refetches state. CORS is controlled
by `ABACUS_CORS_ORIGINS` in `.env.local` (default allows
`http://localhost:3000,http://127.0.0.1:3000`).

### State shim

`GET /api/:product/state` spawns the subprocess declared under `state.preScript`
in the product's `abacus.json` with `ABACUS_PRODUCT` and `ABACUS_HTTP_QUERY`
(JSON) in the env. The shim must exit 0 and print a JSON object on stdout; the
platform returns that JSON verbatim as `application/json`. Marathon's shim is
`packages/marathon/scripts/get-state.ts` — it reads Beads and returns the active
plan, 14-day window of workouts, recent efforts/activities/flags. Platform code
never parses the response body.

If a product has no `state` entry in `abacus.json`, the route returns 404
`{ error: "no_state_handler" }`. Subprocess timeout is `ABACUS_STATE_SHIM_TIMEOUT_MS`
(default 30s); on timeout the shim is SIGKILLed and 500 `{ error: "shim_failure" }`
is returned. Cold tsx startup can run several seconds — keep this generous.

## Debugging a live agent session

Every queued task runs in its own detached tmux session named `abacus-<task_id>`.

```bash
tmux ls                          # List live agent sessions
tmux attach -t abacus-<task_id>  # Drop into one
# Detach with Ctrl-b d (does NOT kill the session)
```

Per-task logs are piped to `runtime/logs/<task_id>.log`.

## Inspecting the data store

Beads is backed by Dolt. You can query it directly:

```bash
bd list                                        # High-level issue listing
bd show <issue_id>                             # Single issue detail
dolt sql -q "select id, type, status from issues order by updated_at desc limit 20"
```

Dolt branching (for future CI): `dolt branch test/some-topic && dolt checkout test/some-topic`.

## Recovering from a stuck agent

The watchdog force-kills agent sessions that exceed the wall-clock cap today
(`ABACUS_WATCHDOG_WALLCLOCK_SECONDS`, default 600 s). The token cap layers in M3b
once the dispatcher consumes the per-turn JSON usage counter from `claude -p`.
Manual kill:

```bash
tmux kill-session -t abacus-<task_id>
bd update <task_id> --set-metadata status=failed --set-metadata failure_reason=manual
```

## References

- CLAUDE.md (repo tenets)
- docs/architecture.md (module map)
- docs/spec.md (product + technical spec)
