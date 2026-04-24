#!/usr/bin/env tsx
/**
 * M2 acceptance smoke — exercises product discovery, MCP config resolution,
 * the hot-memory loader, and the SELECT-only guard on cold-memory queries.
 * Runs without spinning the full server.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const CORE_CLAUDE_JSON = join(REPO_ROOT, 'packages/abacus/.claude.json');
const BEADS_DOLT_DIR = join(REPO_ROOT, '.beads/embeddeddolt');
import {
  coldMemoryQuery,
  coldMemoryToolSpec,
  discoverProducts,
  loadHotMemory,
  resolveMcpConfig,
  ProductManifest,
} from '../src/index.js';
import { Beads } from '../src/beads.js';

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    console.error(`[m2-smoke] FAIL — ${msg}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const products = await discoverProducts(PACKAGES_DIR);
  assert(products.length >= 1, `expected ≥1 product, got ${products.length}`);
  const names = products.map((p) => p.name);
  console.error('[m2-smoke] discovered:', names.join(', '));

  const anyProduct = products[0]!;
  const parsedManifest = ProductManifest.safeParse(anyProduct.manifest);
  assert(parsedManifest.success, 'manifest failed schema');

  const tmp = await mkdtemp(join(tmpdir(), 'abacus-m2-'));
  try {
    const outPath = await resolveMcpConfig({
      corePath: CORE_CLAUDE_JSON,
      targetDir: tmp,
      product: anyProduct,
    });
    const resolved = JSON.parse(await readFile(outPath, 'utf8'));
    const schema = z.object({ mcpServers: z.record(z.unknown()) });
    assert(schema.safeParse(resolved).success, 'resolved .claude.json missing mcpServers');
    console.error('[m2-smoke] resolved mcp config at', outPath);

    const snapshot = await loadHotMemory(
      new Beads({ cwd: REPO_ROOT }),
      anyProduct.name,
      anyProduct.manifest,
    );
    assert(snapshot.product === anyProduct.name, 'snapshot product mismatch');
    assert(Array.isArray(snapshot.items), 'snapshot items not an array');
    console.error(
      `[m2-smoke] hot memory for ${anyProduct.name}: ${snapshot.items.length} item(s) in ${snapshot.windowDays}d window`,
    );

    let rejected = false;
    try {
      await coldMemoryQuery('DELETE FROM issues', { doltDir: BEADS_DOLT_DIR });
    } catch {
      rejected = true;
    }
    assert(rejected, 'coldMemoryQuery accepted a non-SELECT statement');

    const spec = coldMemoryToolSpec();
    assert(spec.name === 'query_history', 'cold-memory tool name mismatch');
    console.error('[m2-smoke] cold-memory SELECT-only guard ok');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  console.error('[m2-smoke] OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[m2-smoke] fatal', err);
  process.exit(1);
});
