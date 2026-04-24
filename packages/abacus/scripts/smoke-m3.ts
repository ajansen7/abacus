#!/usr/bin/env tsx
/**
 * M3 acceptance smoke — exercises ClaudeRunner.prepare end-to-end without
 * spawning a real `claude` process. Verifies that for a (product, kind) tuple,
 * the runner:
 *   - resolves the per-kind handler from the product's abacus.json
 *   - substitutes prompt tokens (taskId, kind, payloadJson, hotMemoryJson)
 *   - writes the wrapper script with the declared preScript line
 *   - writes the merged MCP config (core + product) to the task dir
 *   - copies the product's claude.md into system.md
 *   - returns a `bash <wrapper>` command shape
 *
 * Runs against the real Beads-backed packages/marathon product. Touches no
 * Beads writes — `prepare` is read-only.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Beads } from '../src/beads.js';
import { ClaudeRunner, ProductRegistry } from '../src/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const CORE_CLAUDE_JSON = join(REPO_ROOT, 'packages/abacus/.claude.json');

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    console.error(`[m3-smoke] FAIL — ${msg}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const registry = await ProductRegistry.load(PACKAGES_DIR);
  const products = registry.list();
  assert(products.length >= 1, `expected ≥1 product, got ${products.length}`);
  const target = products[0]!;
  console.error(`[m3-smoke] target product: ${target.name}`);

  const handlerKinds = Object.keys(target.manifest.tasks);
  assert(handlerKinds.length >= 1, `product "${target.name}" declares no task handlers`);
  const kind = handlerKinds[0]!;
  const handler = target.manifest.tasks[kind]!;
  console.error(`[m3-smoke] handler kind: ${kind} (preScript=${handler.preScript ?? 'none'})`);

  const beads = new Beads({ cwd: REPO_ROOT });
  const runner = new ClaudeRunner({ beads, registry, corePath: CORE_CLAUDE_JSON });
  assert(runner.name === 'claude', 'runner.name should be "claude"');

  const taskDir = await mkdtemp(join(tmpdir(), 'abacus-m3-'));
  try {
    const taskId = 'task-m3-smoke-001';
    const samplePayload = { sentinel: 'm3-smoke-payload', n: 42 };
    const prepared = await runner.prepare({
      taskId,
      taskDir,
      logFile: join(taskDir, 'run.log'),
      exitFile: join(taskDir, 'exit.code'),
      product: target.name,
      kind,
      payload: samplePayload,
    });

    assert(
      prepared.command.startsWith('bash '),
      `expected command to start with "bash ", got: ${prepared.command}`,
    );
    assert(prepared.cwd === taskDir, `prepared.cwd should be the task dir`);

    const scriptPath = join(taskDir, 'run.sh');
    const script = await readFile(scriptPath, 'utf8');
    assert(script.startsWith('#!/usr/bin/env bash'), 'wrapper missing shebang');
    assert(script.includes(`ABACUS_TASK_ID='${taskId}'`), 'wrapper missing ABACUS_TASK_ID');
    assert(
      script.includes(`ABACUS_PRODUCT='${target.name}'`),
      'wrapper missing ABACUS_PRODUCT',
    );
    assert(script.includes(`ABACUS_KIND='${kind}'`), 'wrapper missing ABACUS_KIND');
    assert(script.includes('m3-smoke-payload'), 'wrapper missing payload sentinel');
    if (handler.preScript) {
      assert(
        script.includes(handler.preScript),
        `wrapper missing preScript line: ${handler.preScript}`,
      );
    }
    assert(
      script.includes("'claude' -p"),
      'wrapper missing claude invocation line',
    );

    const promptPath = join(taskDir, 'prompt.txt');
    const prompt = await readFile(promptPath, 'utf8');
    assert(prompt.includes(taskId), 'prompt missing substituted taskId');
    assert(prompt.includes('m3-smoke-payload'), 'prompt missing substituted payload JSON');
    assert(
      prompt.includes('"product"') || prompt.includes('"items"'),
      'prompt missing hot-memory snapshot JSON',
    );
    assert(!prompt.includes('{{taskId}}'), 'prompt left unsubstituted {{taskId}}');
    assert(!prompt.includes('{{payloadJson}}'), 'prompt left unsubstituted {{payloadJson}}');
    assert(
      !prompt.includes('{{hotMemoryJson}}'),
      'prompt left unsubstituted {{hotMemoryJson}}',
    );

    const systemPath = join(taskDir, 'system.md');
    const systemPrompt = await readFile(systemPath, 'utf8');
    assert(systemPrompt.length > 0, 'system.md empty — claude.md not picked up');

    const mcpConfigPath = join(taskDir, '.claude.json');
    const mcpConfig = JSON.parse(await readFile(mcpConfigPath, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert(
      mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object',
      'resolved .claude.json missing mcpServers',
    );
    const productServers = Object.keys(target.mcpServers);
    for (const name of productServers) {
      assert(
        name in mcpConfig.mcpServers,
        `merged .claude.json missing product server "${name}"`,
      );
    }

    console.error('[m3-smoke] wrapper, prompt, system, and merged mcp config all valid');
  } finally {
    await rm(taskDir, { recursive: true, force: true });
  }

  let threw = false;
  try {
    const beads2 = new Beads({ cwd: REPO_ROOT });
    const runner2 = new ClaudeRunner({ beads: beads2, registry, corePath: CORE_CLAUDE_JSON });
    const tmp2 = await mkdtemp(join(tmpdir(), 'abacus-m3-neg-'));
    try {
      await runner2.prepare({
        taskId: 'task-m3-neg',
        taskDir: tmp2,
        logFile: join(tmp2, 'run.log'),
        exitFile: join(tmp2, 'exit.code'),
        product: target.name,
        kind: 'definitely_not_a_declared_kind',
        payload: null,
      });
    } finally {
      await rm(tmp2, { recursive: true, force: true });
    }
  } catch (err) {
    threw = (err as Error).message.includes('no handler for kind');
  }
  assert(threw, 'runner should reject unknown kinds with a "no handler for kind" error');
  console.error('[m3-smoke] unknown-kind rejection ok');

  console.error('[m3-smoke] OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[m3-smoke] fatal', err);
  process.exit(1);
});
