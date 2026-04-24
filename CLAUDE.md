# Abacus

**An orchestration platform for headless, agentic products built on Claude Code.**

Abacus is the reusable platform. _Products_ are built on top of it. The Marathon
Planner in `packages/marathon/` is the first product, and the PoC that validates the
platform — but Abacus is designed from day one for many products (future candidates
include a trip planner, family weekly planner, meal planner, and others). The
platform/product boundary is load-bearing; see tenet 5.

This file is the engineering constitution for working _in_ this repo. It is distinct
from the per-product `packages/*/claude.md` files, which are runtime constitutions for
the agents that Abacus spawns at execution time.

Current plan: `/Users/alexjansen/.claude/plans/product-technical-specificationproject-hazy-neumann.md`
Living spec: `docs/spec.md` (to be authored as the project grows).

---

## Working tenets

These are load-bearing for every change in this repo. When a tenet conflicts with
speed, convenience, or "just this once" — the tenet wins.

### 1. Product lens — probe the goal before you execute

Before non-trivial work, surface the _why_ behind the request. Ask: what is the user
actually trying to achieve? What would "done" feel like to them? If an ask looks like
it's solving the wrong problem, say so before writing code. Literal execution of an
ambiguous request is a failure mode, not a service.

Concretely: open with a question, not with code. If requirements clarify as you work,
raise it — don't silently reinterpret.

### 2. Documentation is a first-class deliverable

Every change ships with `README.md` and `docs/` updates so both remain true. Docs are
a living, breathing, accurate reflection of what this project _currently does_ — not
what it used to do, not what it plans to do. Stale docs are a bug.

If a feature isn't documented, it doesn't exist. A change that alters observable
behavior without a README/docs update is incomplete.

Structure of `docs/` (grows as the project grows; don't stub ahead):

- `docs/spec.md` — living product + technical spec
- `docs/architecture.md` — module map and boundaries
- `docs/runbook.md` — operate and debug the running system
- `docs/adr/NNNN-title.md` — append-only architectural decisions, dated; never edit a prior ADR, supersede it with a new one

### 3. Zero Framework Cognition (ZFC)

Orchestrator code (`packages/abacus/`) and deterministic product scripts
(`packages/*/scripts/`) are forbidden from classifying, scoring, routing-on-content,
or quality-judging payloads. **All reasoning lives in Claude Code sessions and in
product `claude.md` files.**

- Allowed: IO, schema validation, policy enforcement (budget/auth/timeouts/dedupe), state tracking, logging.
- Forbidden: keyword routing, heuristic scoring, content-based retries, "smart" fallbacks, quality judgments on agent output beyond schema conformance.

If you're about to add an `if` that branches on _payload content_ in orchestrator
code — stop. That logic belongs in a `claude.md` or an agent prompt, not here.

### 4. DRY — reuse before you add

Grep before you write. Check `packages/abacus/core-tools/`, each product's
`scripts/`, existing utilities, and the shared zod schemas in
`packages/abacus/src/types.ts`. Before adding a dependency, check what's already
installed. Before inventing a type, see if one exists to extend.

Duplication is a design failure, not a shortcut.

### 5. Platform and products are separate — and stay separate

Abacus is a reusable platform. Multiple products will live on top of it. The
boundary between them is the single most important architectural line in the repo.

- **Platform code (`packages/abacus/`)** knows _nothing_ about any specific product domain — no marathon concepts, no Strava, no trip planning, no meal-planning ingredients. If a name from a product domain appears in platform code, it's a bug.
- **Product code (`packages/<product>/`)** depends on Abacus via its public exports only — never by reaching into `abacus/src/` internals. Products should be drop-in addable and drop-in removable; adding a new product must not require editing `packages/abacus/`.
- **No product knows about another product.** Cross-product references (marathon importing from trip-planner, etc.) are forbidden. Products compose only via the platform.
- **New products are added by convention, not configuration.** A product is `packages/<name>/` with its `claude.md`, `.claude.json`, `scripts/`, and `mcp-servers/`. Abacus discovers it — there is no platform-side registry to edit when adding a product.
- Each module has one job. If a file is doing two, split it.
- Public platform interfaces are contracts. Once exported, treat them as API — change with care and document the change in an ADR.
- Every inbound payload (HTTP, webhook, MCP tool call) validates via a zod schema at the boundary, _before_ any business logic sees it.

Clean separation up front is cheaper than retrofitting later. The cost of getting
this wrong compounds with every additional product.

---

## Stack reference (decided)

Node.js + TypeScript (strict) · Fastify · Next.js App Router + Tailwind ·
Beads (`bd`) / Dolt as single source of truth · headless
`claude -p --output-format json` inside detached `tmux` · OpenTelemetry ·
pnpm workspaces.

## Before you implement anything

1. Re-read the tenet that covers the change you're about to make.
2. Check the current plan for where this work fits.
3. If the task is non-trivial, open with a question about intent — not after the code is half-written.
4. When you finish, update `README.md` and the relevant `docs/` file in the same change.

## Beads as a data layer — not an agent-workflow tool

Abacus uses `bd` (Beads) as the underlying data store for queue rows, memory, and
product entities (types namespaced `platform:<kind>` / `<product>:<kind>`). It is
_not_ the coding-agent's task tracker, and its "stealth integration" (`bd prime`
hooks, auto-injected CLAUDE.md sections, an AGENTS.md file) is deliberately
_not_ installed here — if `bd init` is ever re-run in this repo, strip those
artifacts back out. Platform code drives `bd` programmatically via
`packages/abacus/src/beads.ts`; humans and coding agents track work through the
usual mechanisms.
