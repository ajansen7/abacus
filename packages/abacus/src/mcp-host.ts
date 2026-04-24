import { readdir, readFile, stat, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ClaudeConfig,
  DiscoveredProduct,
  ProductManifest,
  ProductName,
  type McpServerSpec,
} from './types.js';

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(path: string): Promise<unknown | null> {
  if (!(await fileExists(path))) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * Discover products by convention. A product is any first-level directory under
 * `packagesDir` that contains all three marker files:
 *   - `claude.md`     — runtime constitution for agent sessions
 *   - `.claude.json`  — MCP server registrations
 *   - `abacus.json`   — platform-scoped manifest (hot-memory policy, etc.)
 *
 * The platform's own package does not author `abacus.json`, so it is not
 * discovered as a product — there is no hardcoded "this is the platform"
 * filter, the convention itself draws the line. Returns products sorted by
 * name for stable output.
 */
export async function discoverProducts(packagesDir: string): Promise<DiscoveredProduct[]> {
  const root = resolve(packagesDir);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const discovered: DiscoveredProduct[] = [];
  for (const name of entries) {
    const dir = join(root, name);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const claudeMd = join(dir, 'claude.md');
    const claudeJson = join(dir, '.claude.json');
    const manifestPath = join(dir, 'abacus.json');
    if (!(await fileExists(claudeMd))) continue;
    if (!(await fileExists(claudeJson))) continue;
    if (!(await fileExists(manifestPath))) continue;

    const productCheck = ProductName.safeParse(name);
    if (!productCheck.success) continue;

    const claudeCfgRaw = await readJsonIfExists(claudeJson);
    const claudeCfg = ClaudeConfig.parse(claudeCfgRaw ?? {});

    const manifestRaw = await readJsonIfExists(manifestPath);
    const manifest = ProductManifest.parse(manifestRaw ?? {});

    discovered.push({
      name: productCheck.data,
      dir,
      manifest,
      mcpServers: claudeCfg.mcpServers,
    });
  }

  return discovered.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ResolveMcpOptions {
  /** Absolute path to the platform's own `.claude.json` (core MCP servers). */
  corePath: string;
  /** Directory the resolved `.claude.json` should be written to. */
  targetDir: string;
  /** The product whose servers should be merged with core. */
  product: DiscoveredProduct;
}

/**
 * Merge core MCP servers with a product's MCP servers and write the resolved
 * config to `targetDir/.claude.json`. Naming collisions are flagged — product
 * servers must namespace their own names.
 */
export async function resolveMcpConfig(opts: ResolveMcpOptions): Promise<string> {
  const coreRaw = await readJsonIfExists(opts.corePath);
  const core = ClaudeConfig.parse(coreRaw ?? {});

  const merged: Record<string, McpServerSpec> = { ...core.mcpServers };
  for (const [name, spec] of Object.entries(opts.product.mcpServers)) {
    if (merged[name]) {
      throw new Error(
        `mcp-host: server name collision "${name}" — product "${opts.product.name}" must namespace its MCP server names`,
      );
    }
    merged[name] = spec;
  }

  const resolved = { mcpServers: merged };
  await mkdir(opts.targetDir, { recursive: true });
  const outPath = join(opts.targetDir, '.claude.json');
  await writeFile(outPath, JSON.stringify(resolved, null, 2), 'utf8');
  return outPath;
}
