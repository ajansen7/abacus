#!/usr/bin/env tsx
// No-op pre-script. The task's value is the agent prompt + hot-memory snapshot.
// Kept as its own file for symmetry with other tasks and as a hook for future
// pre-aggregation (e.g., weekly mileage summary) without rewriting abacus.json.
process.stdout.write(JSON.stringify({ ok: true }) + '\n');
