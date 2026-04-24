# ADR 0001 — Platform stack decisions

- **Status:** accepted
- **Date:** 2026-04-19
- **Context milestone:** M0 — monorepo bootstrap

## Context

Abacus is greenfield. Before scaffolding, several foundational decisions had to be
made that are hard to reverse later. Capturing them here so the reasoning survives
beyond the original planning session.

## Decisions

### 1. Runtime: Node.js + TypeScript (strict)

Chosen over Python/FastAPI and Go. Rationale:

- The original spec named `server.js`, signalling Node intent.
- First-class Model Context Protocol (MCP) SDK in TypeScript.
- SSE and webhook handling are trivial in Fastify.
- The Next.js dashboard co-locates cleanly with a Node/TS platform.

Trade-off accepted: Go would have given a single static binary and simpler supervision
of many concurrent tmux sessions. Node is sufficient for PoC scale.

### 2. Data layer: Beads as the single store

Chosen over "raw Dolt only" and "Beads for memory + sibling Dolt domain tables."
Rationale:

- The spec demanded "a single graph-database solution."
- Beads is itself Dolt-powered, so git-for-data branching is available for free.
- Beads' built-in memory decay and dependency-graph features map cleanly onto Hot/Cold memory semantics.

Trade-off accepted: Beads was designed for task/memory issues, not arbitrary domain
data. Workout/plan/effort records are modeled as typed Beads issues (`<product>:<kind>`
namespacing). If this breaks down during M3, the fallback — sibling Dolt tables in the
same database — is reachable without a deployment change.

### 3. HTTP server: Fastify

Chosen over Express, Hono, and Koa. Rationale: modern async-first, schema-first, plug-in
SSE (`@fastify/sse-v2`), and zod integration is straightforward.

### 4. UI stack: Next.js (App Router) + Tailwind

Chosen over SvelteKit, HTMX, and a Vite SPA. Rationale: co-locates with the Node/TS
platform, trivial SSE in App Router, mobile-first styling via Tailwind.

Trade-off accepted: two Node processes in dev (Fastify + Next.js). Acceptable for PoC;
unifiable behind a reverse proxy later.

### 5. Package manager: pnpm workspaces

Chosen over npm and yarn. Rationale: fast, strict isolation, workspace protocol handles
the platform↔product dependency cleanly.

### 6. Abacus is a platform, not a project

Product-agnostic from day one. Marathon is product #1 of many (future candidates: family
weekly planner, meal planner, trip planner). Enforced by CI lint rules
(ZFC + platform-purity denylist) and by product discovery being convention-based
(scan `packages/*/`) rather than registry-based.

### 7. Zero Framework Cognition (ZFC)

Platform code and deterministic scripts do no reasoning, classification, or quality
judgement. All such logic lives in Claude Code sessions and in product `claude.md`
files. Enforced by a CI lint rule on `packages/abacus/src/`.

## Consequences

- Adding a future product requires creating `packages/<name>/` with `claude.md`, `.claude.json`, `.platform-denylist`, and — if needed — `scripts/` and `mcp-servers/`. No platform edits should be necessary. Verified by the "drop-in product smoke" in M5.
- Changing any of decisions 1–5 requires a superseding ADR, not an in-place edit of this one.
