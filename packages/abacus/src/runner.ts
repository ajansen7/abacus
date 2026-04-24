import { mkdir, writeFile, chmod, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Beads } from './beads.js';
import { loadHotMemory } from './memory.js';
import { resolveMcpConfig } from './mcp-host.js';
import type { ProductRegistry } from './product-registry.js';

export interface RunnerContext {
  taskId: string;
  taskDir: string;
  logFile: string;
  exitFile: string;
  product: string;
  kind: string;
  payload: unknown;
}

export interface PreparedRunner {
  command: string;
  cwd: string;
}

export interface Runner {
  readonly name: string;
  prepare(ctx: RunnerContext): Promise<PreparedRunner>;
}

function shEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export class DummyRunner implements Runner {
  readonly name = 'dummy';

  async prepare(ctx: RunnerContext): Promise<PreparedRunner> {
    const scriptPath = join(ctx.taskDir, 'run.sh');
    const payloadJson = JSON.stringify(ctx.payload ?? null);
    const script = [
      '#!/usr/bin/env bash',
      'set -u',
      `task_id=${shEscape(ctx.taskId)}`,
      `product=${shEscape(ctx.product)}`,
      `kind=${shEscape(ctx.kind)}`,
      `payload=${shEscape(payloadJson)}`,
      `exit_file=${shEscape(ctx.exitFile)}`,
      'echo "[dummy] task=$task_id product=$product kind=$kind"',
      'echo "[dummy] payload=$payload"',
      'sleep 2',
      'echo "[dummy] done"',
      'echo 0 > "$exit_file"',
      '',
    ].join('\n');
    await mkdir(ctx.taskDir, { recursive: true });
    await writeFile(scriptPath, script, 'utf8');
    await chmod(scriptPath, 0o755);
    return { command: `bash ${shEscape(scriptPath)}`, cwd: ctx.taskDir };
  }
}

export interface ClaudeRunnerOptions {
  beads: Beads;
  registry: ProductRegistry;
  /** Absolute path to the platform's `.claude.json` (core MCP servers). */
  corePath: string;
  /** Absolute path to the `claude` binary. Defaults to `claude` on PATH. */
  claudeBin?: string;
}

interface PreparedFiles {
  promptFile: string;
  systemFile: string;
  mcpConfigFile: string;
  scriptPath: string;
}

/**
 * Production runner. For each task it:
 *   1. Looks up the product's task handler (preScript + prompt template) from
 *      its `abacus.json` via the ProductRegistry — never branches on payload.
 *   2. Loads the product's hot-memory snapshot from Beads.
 *   3. Substitutes prompt tokens.
 *   4. Resolves the merged MCP config (core + product) into the task dir.
 *   5. Writes a wrapper script that runs preScript (if any) then `claude -p`.
 *
 * The platform never reads from the prompt or the response — it only enforces
 * structural validation and policy (watchdog, exit code, log piping).
 */
export class ClaudeRunner implements Runner {
  readonly name = 'claude';

  constructor(private readonly opts: ClaudeRunnerOptions) {}

  async prepare(ctx: RunnerContext): Promise<PreparedRunner> {
    const product = this.opts.registry.require(ctx.product);
    const handler = product.manifest.tasks[ctx.kind];
    if (!handler) {
      throw new Error(
        `claude-runner: product "${ctx.product}" has no handler for kind "${ctx.kind}" — declare it under tasks in abacus.json`,
      );
    }

    const hotMemory = await loadHotMemory(this.opts.beads, ctx.product, product.manifest);
    const payloadJson = JSON.stringify(ctx.payload ?? null);
    const hotMemoryJson = JSON.stringify(hotMemory);

    const prompt = handler.prompt
      .replace(/\{\{taskId\}\}/g, ctx.taskId)
      .replace(/\{\{kind\}\}/g, ctx.kind)
      .replace(/\{\{payloadJson\}\}/g, payloadJson)
      .replace(/\{\{hotMemoryJson\}\}/g, hotMemoryJson);

    const claudeMdPath = join(product.dir, 'claude.md');
    const systemPrompt = (await fileExists(claudeMdPath))
      ? await readFile(claudeMdPath, 'utf8')
      : '';

    await mkdir(ctx.taskDir, { recursive: true });
    const files: PreparedFiles = {
      promptFile: join(ctx.taskDir, 'prompt.txt'),
      systemFile: join(ctx.taskDir, 'system.md'),
      mcpConfigFile: join(ctx.taskDir, '.claude.json'),
      scriptPath: join(ctx.taskDir, 'run.sh'),
    };
    await writeFile(files.promptFile, prompt, 'utf8');
    await writeFile(files.systemFile, systemPrompt, 'utf8');
    await resolveMcpConfig({
      corePath: this.opts.corePath,
      targetDir: ctx.taskDir,
      product,
    });

    const claudeBin = this.opts.claudeBin ?? 'claude';
    const script = this.renderWrapper(ctx, handler.preScript, product.dir, files, claudeBin);
    await writeFile(files.scriptPath, script, 'utf8');
    await chmod(files.scriptPath, 0o755);
    return { command: `bash ${shEscape(files.scriptPath)}`, cwd: ctx.taskDir };
  }

  private renderWrapper(
    ctx: RunnerContext,
    preScript: string | undefined,
    productDir: string,
    files: PreparedFiles,
    claudeBin: string,
  ): string {
    const payloadJson = JSON.stringify(ctx.payload ?? null);
    const lines = [
      '#!/usr/bin/env bash',
      'set -uo pipefail',
      `export ABACUS_TASK_ID=${shEscape(ctx.taskId)}`,
      `export ABACUS_PRODUCT=${shEscape(ctx.product)}`,
      `export ABACUS_KIND=${shEscape(ctx.kind)}`,
      `export ABACUS_PAYLOAD=${shEscape(payloadJson)}`,
      `export ABACUS_TASK_DIR=${shEscape(ctx.taskDir)}`,
      '',
    ];
    if (preScript) {
      lines.push(
        '# pre-script (deterministic IO; product-owned)',
        `( cd ${shEscape(productDir)} && ${preScript} )`,
        'pre_status=$?',
        'if [ $pre_status -ne 0 ]; then',
        `  echo $pre_status > ${shEscape(ctx.exitFile)}`,
        '  exit $pre_status',
        'fi',
        '',
      );
    }
    lines.push(
      '# agent session',
      `( cd ${shEscape(productDir)} && \\`,
      `  ${shEscape(claudeBin)} -p \\`,
      '    --output-format json \\',
      `    --mcp-config ${shEscape(files.mcpConfigFile)} \\`,
      `    --append-system-prompt "$(cat ${shEscape(files.systemFile)})" \\`,
      `    < ${shEscape(files.promptFile)} )`,
      'agent_status=$?',
      `echo $agent_status > ${shEscape(ctx.exitFile)}`,
      'exit $agent_status',
      '',
    );
    return lines.join('\n');
  }
}
