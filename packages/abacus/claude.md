# Abacus — platform constitution

You are running inside the **Abacus platform package**. This file is the runtime
constitution for any agent session that touches `packages/abacus/`. It is distinct
from the repo-root `CLAUDE.md` (engineering tenets for humans + coding agents) and
from per-product `claude.md` files (which hold domain heuristics).

## You are in platform code

Abacus is product-agnostic. It hosts many products under `packages/<name>/` —
Marathon is product #1, more will follow. Your work in this package must stay
useful to every product equally.

**Forbidden in this package, under any circumstance:**

- References to any product-domain concept (marathon, strava, training, workout, effort, pace, meal, recipe, trip, itinerary, etc.). If you find yourself typing such a word in `packages/abacus/src/`, stop — the logic belongs in that product's package, not here.
- Classification, scoring, keyword routing, heuristic decisions, content-based retries, or any quality judgement on agent output beyond schema conformance.
- Hardcoded product registries, product-name allowlists, or `if product === 'marathon'` style branching.

**Allowed, and the platform's actual job:**

- Pure IO (HTTP, webhooks, process spawning, file-system, Beads/Dolt reads and writes).
- Structural validation via zod at every boundary.
- Policy enforcement: budget caps, wall-clock timeouts, iteration limits, dedupe, auth.
- State tracking and lifecycle events.
- Discovery of products by convention (scan `packages/*/` for `claude.md` + `.claude.json` + `abacus.json`).

## Zero Framework Cognition (ZFC) — the operating principle

Every event Abacus processes follows exactly four phases:

1. **Gather raw context** — IO only. Read the request, load Hot Memory from Beads.
2. **Call the AI for decisions** — hand context to a detached Claude Code session in `tmux`. The AI does all classification, selection, reasoning.
3. **Validate structure** — check the AI's MCP tool calls for schema conformance and policy. Never judge quality.
4. **Execute mechanically** — run the AI's decided actions without modification.

If you are writing an `if` that branches on _payload content_ in this package,
you are violating ZFC. That logic belongs in a prompt, a `claude.md` file, or
a product's MCP server.

## Load-bearing constraints

- **Product discovery is by convention.** `mcp-host.ts` scans `packages/*/` for any directory containing all three marker files: `claude.md`, `.claude.json`, and `abacus.json`. There is no registry file to edit when a product is added.
- **Platform-purity lint.** CI greps `packages/abacus/src/` against every product's `.platform-denylist`. A match fails the build.
- **Schemas at boundaries.** Every inbound payload (HTTP, webhook, MCP tool call) validates via a zod schema from `packages/abacus/src/types.ts` before any other code sees it.
- **Public interfaces are contracts.** Only the exports from `packages/abacus/src/index.ts` are the API for products. Products that reach into internals are a bug on _their_ side; platform must never accommodate such coupling.

## Reference — full plan and spec

- Repo tenets: `/CLAUDE.md`
- Spec + plan: `/docs/spec.md`, `/docs/architecture.md`
- Full plan file: `/Users/alexjansen/.claude/plans/product-technical-specificationproject-hazy-neumann.md`
