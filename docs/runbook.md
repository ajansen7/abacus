# Runbook

> How to bring Abacus up, exercise it, and recover from common failure modes.
> Updated in the same change that alters observable behavior.

## First-time setup

```bash
# From repo root
bash scripts/doctor.sh           # Verify bd, dolt, tmux, claude, node, pnpm
pnpm install                     # Install workspace dependencies
cp .env.example .env.local       # Fill in Strava creds, watchdog caps, OTLP endpoint
```

## Bringing the whole stack up (one command)

```bash
bash scripts/dev-up.sh
```

Starts (in order):

1. Abacus platform (Fastify on `:3001`, `ABACUS_RUNNER=claude`)
2. Marathon dashboard (Next.js on `:3000`)
3. `cloudflared` quick tunnel — prints a public `https://*.trycloudflare.com` URL
4. Strava webhook subscription pointing at the tunnel URL

Cleans up the Strava subscription and child processes on `Ctrl-C` /
`SIGTERM`. Per-process logs land in `runtime/dev-logs/{platform,dashboard,cloudflared}.log`.

Flags:

- `--no-tunnel` — skip cloudflared + Strava subscription (use when you don't need the public webhook)
- `--no-dashboard` — skip the dashboard (e.g., backend-only iteration)

`dev-up.sh` refuses to start if `:3001` (or `:3000` when the dashboard is on) is
already bound, so it never silently fights an existing process.

## Running pieces individually

### Platform

```bash
pnpm --filter @abacus/platform dev     # Watch mode: tsx watch src/main.ts
pnpm --filter @abacus/platform start   # Built artifact: node dist/main.js
```

Fastify listens on `ABACUS_HOST:ABACUS_PORT` (default `127.0.0.1:3001`). HTTP
request logging is off by default — set `ABACUS_HTTP_LOG=1` to enable it.

### Runner selection

`ABACUS_RUNNER` controls which runner the dispatcher uses for spawned tasks:

- `dummy` (default) — writes a no-op bash script that echoes + sleeps + exits 0. Used for tests and the smoke suite.
- `claude` — the production runner. Looks up the per-(product, kind) handler from each product's `abacus.json`, runs the declared `preScript` for deterministic IO, then spawns `claude -p --output-format json --mcp-config <merged> --append-system-prompt <product/claude.md>` with the rendered prompt on stdin.

Set `ABACUS_RUNNER=claude` in `.env.local` once `claude` is on PATH and a product
declares the `(kind)` you intend to invoke.

### Marathon dashboard

```bash
pnpm --filter @abacus-products/marathon-dashboard dev
```

Next.js on `127.0.0.1:3000`. The dashboard reads initial state via
`GET /api/marathon/state`, submits effort logs via `POST /api/marathon/invoke`,
and subscribes to `/api/marathon/events` (SSE). On
`TASK_COMPLETE`/`TASK_FAILED` it refetches state. CORS is controlled by
`ABACUS_CORS_ORIGINS` in `.env.local` (default allows
`http://localhost:3000,http://127.0.0.1:3000`).

The platform must be running first — the dashboard's API routes proxy through to
Fastify on `:3001`.

## Marathon — Strava onboarding + webhook subscription

One-time OAuth handshake (writes `STRAVA_REFRESH_TOKEN` to `.env.local`):

```bash
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-onboard.ts
```

Starts a local HTTP server on `127.0.0.1:43117`, prints an authorize URL, and
waits for the redirect callback. Strava app's "Authorization Callback Domain"
must be set to `localhost`.

For the webhook subscription, the platform needs to be reachable from the
public internet. `dev-up.sh` handles this end-to-end (cloudflared + subscribe).
Manual flow:

```bash
# 1. Start the platform with the real runner
ABACUS_RUNNER=claude pnpm --filter @abacus/platform dev

# 2. In another terminal, expose 3001
cloudflared tunnel --url http://127.0.0.1:3001
# (or `ngrok http 3001`)

# 3. Register the webhook with Strava (one subscription per app)
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts \
  --callback https://<tunnel-id>.trycloudflare.com/api/marathon/webhook/strava

# List / delete existing subscriptions
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --list
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --delete <id>
```

Strava performs the `hub.challenge` handshake the moment `--callback` is
registered; the platform routes the GET to
`packages/marathon/scripts/strava-webhook-shim.ts`, which validates
`hub.verify_token` against `STRAVA_VERIFY_TOKEN` in `.env.local` and echoes
the challenge back. Any activity you then record on Strava POSTs to the same
URL; the shim transforms it into an `enqueue(process_activity)` action with a
dedupe key of
`strava:<subscription_id>:<object_type>:<object_id>:<aspect_type>:<event_time>`.

## Marathon — seeding a plan

```bash
pnpm --filter @abacus-products/marathon exec tsx scripts/seed-plan.ts \
  --weeks 4 --goal-pace 5:00 --race 2026-06-14
```

Writes 1 `marathon:training-plan` + 4 `marathon:week-block` + 28
`marathon:workout` issues to Beads. Deterministic — re-run is additive (no
upsert; close the old plan first if you want a clean slate).

## HTTP surface

| Route                                    | Purpose                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `POST /api/:product/invoke`              | Enqueue a task — returns `{ taskId, status }`        |
| `POST /api/:product/webhook/:source`     | Generic webhook intake (validates + enqueues)        |
| `GET  /api/:product/state`               | Product-owned read: spawns the `state` shim          |
| `GET  /api/:product/events`              | SSE stream of task lifecycle events for that product |
| `GET  /api/:product/tasks`               | List recent tasks for the product                    |
| `GET  /api/:product/task/:taskId`        | Fetch a single task                                  |
| `GET  /api/:product/task/:taskId/stream` | Tail the task's tmux log file                        |

## Smoke tests

```bash
pnpm --filter @abacus/platform smoke          # server + dispatcher + tmux end-to-end (DummyRunner)
pnpm --filter @abacus/platform smoke:m2       # product discovery + memory + cold-query SELECT-only guard
pnpm --filter @abacus/platform smoke:m3       # ClaudeRunner.prepare wiring (no real claude spawn)
pnpm --filter @abacus/platform smoke:webhook  # webhook shim: handshake + enqueue + rejection paths
pnpm --filter @abacus/platform smoke:m5       # drop-in product synthesized in tmpdir + OTel trace tree
```

What each one covers:

- `smoke` boots the server in-process, subscribes to SSE, posts to `/api/_test/invoke`, and waits up to 30s for a matching `TASK_COMPLETE` event + `completed` status in Beads. The hardest end-to-end check the platform has under the dummy runner.
- `smoke:m2` exercises product discovery (scan + manifest parse), MCP config resolution, the hot-memory loader, and the SELECT-only guard on cold-memory queries.
- `smoke:m3` calls `ClaudeRunner.prepare` against the real marathon product and asserts the generated wrapper script, prompt, system prompt, and merged MCP config are all well-formed (without spawning `claude`).
- `smoke:webhook` runs the marathon Strava webhook shim through happy-path challenge, valid POST → enqueue, and various rejection paths (bad verify_token, missing fields).
- `smoke:m5` is the **platform/product separation regression test**: synthesizes a throwaway product in a tmpdir, points the platform at it via `ABACUS_PACKAGES_DIR`, runs a task end-to-end, and asserts a single OTel trace with `task.received → task.settled → {runner.prepare, tmux.spawned}`. Proves a brand-new product needs zero edits to `packages/abacus/`.

All smokes exit non-zero on any failure.

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

## State shim

`GET /api/:product/state` spawns the subprocess declared under `state.preScript`
in the product's `abacus.json` with `ABACUS_PRODUCT` and `ABACUS_HTTP_QUERY`
(JSON) in the env. The shim must exit 0 and print a JSON object on stdout; the
platform returns that JSON verbatim as `application/json`. Marathon's shim is
`packages/marathon/scripts/get-state.ts` — it reads Beads and returns the active
plan, 14-day window of workouts, recent efforts/activities/flags. Platform code
never parses the response body.

If a product has no `state` entry in `abacus.json`, the route returns 404
`{ error: "no_state_handler" }`. Subprocess timeout is
`ABACUS_STATE_SHIM_TIMEOUT_MS` (default 30s); on timeout the shim is SIGKILLed
and 500 `{ error: "shim_failure" }` is returned. Cold tsx startup can run
several seconds — keep this generous.

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

The watchdog force-kills agent sessions that exceed the wall-clock cap
(`ABACUS_WATCHDOG_WALLCLOCK_SECONDS`, default 600 s). Token-cap parsing from
`claude -p` per-turn JSON is currently advisory — wall-clock is the hard guard.

Manual kill:

```bash
tmux kill-session -t abacus-<task_id>
bd update <task_id> --set-metadata status=failed --set-metadata failure_reason=manual
```

If `dev-up.sh` is killed ungracefully and leaves a Strava subscription dangling,
clean it up by hand:

```bash
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --list
pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --delete <id>
```

## Observability — OTel traces

The platform emits OpenTelemetry spans for every task lifecycle. The default
exporter is a zero-infra JSONL file, written to:

```
runtime/otel/spans-<startedAt>.jsonl
```

…where `<startedAt>` is the platform-process start ISO timestamp. Each line is
one span (name, traceId, spanId, parentSpanId, durationNs, attributes, events).

Span tree per task (single trace, propagated via the `traceparent` field on the
task's Beads metadata):

```
task.received  (server / queue boundary)
└── task.settled  (dispatcher umbrella, ends on terminal status)
    ├── runner.prepare  (DummyRunner / ClaudeRunner.prepare)
    │   └── memory.loaded  (when ClaudeRunner is active)
    └── tmux.spawned
```

`abacus.outcome` on `task.settled` is one of `completed | failed | aborted`.
`abacus.failure_reason` is set on failures (e.g., `wallclock_exceeded`,
`runner_exit_<n>`, `runner_crashed`).

To export to a real OTel backend (Jaeger, Tempo, otelcol, etc.) instead of (or
in addition to) the JSONL file, set `OTEL_EXPORTER_OTLP_ENDPOINT` in
`.env.local` — the OTLP HTTP exporter is added automatically when the env var
is non-empty. To turn OTel off entirely, set `OTEL_DISABLE=1`.

Example: tail today's spans for the last `task.settled` outcome:

```bash
ls -t runtime/otel/spans-*.jsonl | head -1 | xargs jq -c '
  select(.name=="task.settled") |
  {task: .attributes["abacus.task_id"], outcome: .attributes["abacus.outcome"], ms: (.durationNs/1e6)}'
```

## References

- `CLAUDE.md` — repo tenets
- `docs/architecture.md` — module map
- `docs/spec.md` — product + technical spec
