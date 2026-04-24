# Abacus

**An orchestration platform for headless, agentic products built on Claude Code.**

Abacus is a locally hosted, remotely accessible platform. It handles API routing,
webhook listening, task queuing, and cross-session memory. It spawns isolated Claude
Code sessions in detached `tmux` to do the actual reasoning, with strict budget and
iteration guardrails. The platform itself contains zero domain logic — that lives in
each product.

## Products

Abacus hosts many products. Each is a folder under `packages/<name>/`.

| Product               | Package              | Status               |
| --------------------- | -------------------- | -------------------- |
| Marathon Planner      | `packages/marathon/` | v0 PoC — in progress |
| Family weekly planner | _planned_            | future               |
| Meal planner          | _planned_            | future               |
| Trip planner          | _planned_            | future               |

Adding a product is by convention: create a `packages/<name>/` directory with
`claude.md`, `.claude.json`, `abacus.json` (platform-scoped manifest with the
hot-memory policy), and `.platform-denylist`. The platform discovers it
automatically — no code changes to `packages/abacus/`.

## Current status — M3 marathon ZFC scripts + real `claude` runner wired

The platform now ships with a real `ClaudeRunner` (set `ABACUS_RUNNER=claude` in env;
the dummy runner remains the default for tests). For each task the runner resolves
the per-kind handler from the product's `abacus.json`, runs the declared `preScript`
(deterministic IO; product-owned), then spawns `claude -p --output-format json` with
the merged MCP config and the product's `claude.md` as system prompt.

Marathon (product #1) ships its first ZFC scripts and MCP server:

- `scripts/seed-plan.ts` — deterministically lays down 1 plan + N week-blocks + 7N workouts in Beads.
- `scripts/ingest-perceived-effort.ts` — webhook handler for the slider; writes a `marathon:effort-log` issue.
- `scripts/fetch-and-store-strava.ts` — Strava webhook ZFC; refreshes OAuth, fetches activity, writes a `marathon:strava-activity` issue. Has `STRAVA_OFFLINE=1` mode for tests.
- `mcp-servers/training-plan/` — exposes `get_plan`, `update_workout`, `query_history`, `flag_overtraining` to the agent.

**Smoke tests**: `pnpm --filter @abacus/platform smoke` (M1 server end-to-end),
`pnpm --filter @abacus/platform smoke:m2` (discovery + memory + cold-query guard),
`pnpm --filter @abacus/platform smoke:m3` (ClaudeRunner.prepare wiring), and
`pnpm --filter @abacus/platform smoke:webhook` (webhook shim: handshake, enqueue,
rejection paths against the real marathon Strava shim — no live Strava call).

**M3b — Strava OAuth + webhook subscription + shim dispatch** is now wired:
`scripts/strava-onboard.ts` runs the OAuth handshake against a local callback
server and writes `STRAVA_REFRESH_TOKEN`; `scripts/strava-subscribe.ts` creates /
lists / deletes push-subscriptions via Strava's API; `scripts/strava-webhook-shim.ts`
handles the `hub.challenge` handshake + transforms Strava POSTs into
`enqueue(process_activity)` actions with a dedupe key. Platform remains ZFC-pure
via a generic `webhooks[source] = { preScript }` shim mechanism in `abacus.json`.
See the runbook for the ngrok-based end-to-end flow.

**Still deferred**: watchdog token-cap parsing from `claude -p` per-turn JSON
usage counter. M4 (Next.js dashboard) and M5 (OTel + drop-in product smoke) follow.

## Repo layout

```
packages/
  abacus/          # The platform (product-agnostic)
  marathon/        # Product #1 (PoC)
apps/
  dashboard/       # Next.js UI (arrives in M4)
docs/
  spec.md          # Living product + technical spec
  architecture.md  # Module map and boundaries
  runbook.md       # Operate / debug
  adr/             # Append-only architectural decisions
scripts/
  doctor.sh        # Preflight — verifies bd, dolt, tmux, claude, node, pnpm
```

## Quick start

```bash
# Preflight — checks every required binary is present
bash scripts/doctor.sh

# Install workspace dependencies
pnpm install

# Copy local env template and fill in secrets
cp .env.example .env.local

# Start the platform (Fastify on :3001, dummy runner)
pnpm --filter @abacus/platform dev

# Or run the end-to-end smoke test (boots the server + exits on TASK_COMPLETE)
pnpm --filter @abacus/platform smoke
```

**Required tools** (verified by `doctor.sh`): Node ≥ 22, pnpm (via corepack), `bd`
(Beads CLI), `dolt`, `tmux`, `claude` (Claude Code CLI). On macOS these install via
Homebrew (`bd`, `dolt`, `tmux`), mise/nvm/fnm (Node), corepack (pnpm), and the
official Claude Code installer.

## Core principles

Abacus is built on five load-bearing tenets (see `CLAUDE.md` for the full text):

1. **Product lens** — probe the goal before executing.
2. **Documentation is a first-class deliverable** — README and `docs/` updated with every change.
3. **Zero Framework Cognition (ZFC)** — platform code does no reasoning; all judgement lives in Claude sessions and product `claude.md` files.
4. **DRY** — reuse before you add.
5. **Platform and products stay separate** — platform never names a product domain; products never reach into platform internals; products never reference other products.

## Plan & spec

- `docs/spec.md` — living product + technical specification
- `docs/architecture.md` — module map
- `docs/adr/` — architectural decisions
- `CLAUDE.md` — engineering tenets (this file's senior sibling for coding agents)

## License

TBD.
