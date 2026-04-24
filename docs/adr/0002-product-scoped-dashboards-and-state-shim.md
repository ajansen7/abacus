# ADR 0002 — Product-scoped dashboards and the state shim

- **Status:** accepted
- **Date:** 2026-04-24
- **Context milestone:** M4 — dashboard

## Context

The original plan (M4) placed the UI at `apps/dashboard/` as a top-level sibling of
`packages/`. When we began implementation, two things collided:

1. A dashboard needs product-shaped reads — "this week's workouts", "recent effort
   logs" — and we had no read endpoint. The only read surfaces on the platform
   (`/tasks`, `/task/:id`) are generic and talk about agent tasks, not domain
   state.
2. The proposed location (`apps/dashboard/`) was a marathon-specific UI sitting
   outside any product package. When product #2 lands it would either need its
   own dashboard bolted into `apps/`, or we'd be sharing a dashboard across
   products — a boundary violation.

## Decisions

### 1. Dashboards are product-scoped

Each product that wants a UI owns its own Next.js app under
`packages/<product>/dashboard/`. Platform provides no dashboard, no shared UI,
no cross-product shell. Adding a product that needs a UI means adding
`packages/<name>/dashboard/` — platform is untouched.

This lines up with tenet 5 (platform and products are separate) and tenet 3
(ZFC — platform holds no product vocabulary). A platform-level dashboard
would need to know domain words to render them.

The marathon dashboard lives at `packages/marathon/dashboard/`, runs on
`:3000`, and talks to Abacus on `:3001` over HTTP + SSE.

### 2. State reads flow through a per-product shim

Rather than adding `/issues` or `/query` routes on the platform (which would
either leak Beads shape or let products branch-by-product on the server), we
extend the existing shim pattern used for webhooks.

Products may declare a `state.preScript` in `abacus.json`. The platform
exposes `GET /api/:product/state`, which:

1. Spawns the declared script with the query string in env
   (`ABACUS_HTTP_QUERY` as JSON).
2. Captures stdout.
3. Parses it as JSON and returns it to the caller with
   `content-type: application/json`.

The script is the product's reads surface. It can read Beads, shape the
response however the dashboard needs, and the platform never inspects the
payload. Non-zero exit or non-JSON stdout becomes a 500.

Trade-off accepted: one subprocess per read. For PoC traffic (single user,
dashboard refresh on SSE events, not on every keystroke) this is fine. If
read QPS becomes an issue we revisit — options are a long-lived MCP-style
read server or caching, neither of which we need now.

### 3. The state shim is separate from the webhook shim

They share the "spawn subprocess, capture JSON stdout" plumbing but differ in
envelope: webhooks need method/body/query/headers in env and can respond
with `respond | enqueue | reject`; reads only need query and return raw JSON.
Keeping them as two modules (`webhook-shim.ts`, `state-shim.ts`) makes each
easy to understand. If a third shim variant lands we extract a shared
primitive.

## References

- Tenets: `/CLAUDE.md` (3 and 5)
- Platform constitution: `packages/abacus/claude.md`
- Architecture map: `docs/architecture.md`
