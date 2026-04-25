import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Beads, BdIssue } from './beads.js';
import type { HotMemoryPolicy, ProductManifest } from './types.js';
import { withSpan } from './otel.js';

const execFileAsync = promisify(execFile);

export interface HotMemorySnapshot {
  product: string;
  windowDays: number;
  generatedAt: string;
  items: BdIssue[];
}

/**
 * Load hot memory for a product. The caller supplies the product's manifest —
 * the platform never reads per-product policy from anywhere else. Returns raw
 * Beads issues filtered by the manifest's type list, status filter, and time
 * window.
 */
export async function loadHotMemory(
  beads: Beads,
  product: string,
  manifest: ProductManifest,
  now: Date = new Date(),
): Promise<HotMemorySnapshot> {
  return withSpan(
    'memory.loaded',
    {
      'abacus.product': product,
      'abacus.hot_memory.window_days': manifest.hotMemory.windowDays,
      'abacus.hot_memory.types': manifest.hotMemory.types.join(','),
    },
    async (span) => {
      const policy: HotMemoryPolicy = manifest.hotMemory;
      if (policy.types.length === 0) {
        span.setAttribute('abacus.hot_memory.items', 0);
        return {
          product,
          windowDays: policy.windowDays,
          generatedAt: now.toISOString(),
          items: [],
        };
      }

      const issues = await beads.list(policy.types);
      const windowCutoffMs = now.getTime() - policy.windowDays * 24 * 60 * 60 * 1000;
      const wantOpen = policy.statusFilter.includes('open');
      const wantClosed = policy.statusFilter.includes('closed');

      const filtered: BdIssue[] = [];
      for (const issue of issues) {
        const status = (issue.status ?? 'open').toLowerCase();
        const isClosed = status === 'closed' || status === 'resolved';
        if (isClosed && !wantClosed) continue;
        if (!isClosed && !wantOpen) continue;
        const updatedAt = issue.updated_at ?? issue.created_at;
        if (updatedAt) {
          const ms = Date.parse(updatedAt);
          if (Number.isFinite(ms) && ms < windowCutoffMs) continue;
        }
        filtered.push(issue);
        if (filtered.length >= policy.maxItems) break;
      }

      span.setAttribute('abacus.hot_memory.items', filtered.length);
      return {
        product,
        windowDays: policy.windowDays,
        generatedAt: now.toISOString(),
        items: filtered,
      };
    },
  );
}

export interface ColdMemoryOptions {
  /** Directory containing the Dolt database (embedded under the Beads workspace). */
  doltDir: string;
  /** Upper bound on rows the agent can pull in a single query. */
  rowLimit?: number;
  /** Absolute dolt binary path. Defaults to `dolt` on PATH. */
  doltBin?: string;
}

const SELECT_ONLY = /^\s*(select|with)\b/i;
const BANNED_STATEMENT =
  /\b(insert|update|delete|drop|truncate|alter|create|replace|grant|revoke)\b/i;

/**
 * Execute a read-only cold-memory query against the Dolt database that backs
 * Beads. Enforces SELECT-only syntactically and returns parsed JSON rows. The
 * platform never interprets the payload — the caller (agent, via MCP tool) gets
 * raw rows back.
 */
export async function coldMemoryQuery(
  sql: string,
  opts: ColdMemoryOptions,
): Promise<Record<string, unknown>[]> {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!SELECT_ONLY.test(trimmed)) {
    throw new Error('coldMemoryQuery: only SELECT / WITH statements are allowed');
  }
  if (BANNED_STATEMENT.test(trimmed)) {
    throw new Error('coldMemoryQuery: statement contains a forbidden keyword');
  }
  if (trimmed.includes(';')) {
    throw new Error('coldMemoryQuery: multi-statement queries are not allowed');
  }

  const limit = opts.rowLimit ?? 500;
  const bounded = /\blimit\b/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${limit}`;
  const bin = opts.doltBin ?? 'dolt';
  const { stdout } = await execFileAsync(bin, ['sql', '-q', bounded, '-r', 'json'], {
    cwd: opts.doltDir,
    maxBuffer: 16 * 1024 * 1024,
  });
  const trimmedOut = stdout.trim();
  if (!trimmedOut) return [];
  const parsed: unknown = JSON.parse(trimmedOut);
  const schema = z.object({ rows: z.array(z.record(z.unknown())).default([]) });
  const ok = schema.safeParse(parsed);
  if (ok.success) return ok.data.rows as Record<string, unknown>[];
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  throw new Error(`coldMemoryQuery: unexpected dolt output shape: ${trimmedOut.slice(0, 200)}`);
}

/**
 * MCP tool descriptor the agent can call to pull history on demand. The actual
 * MCP server wiring happens at dispatch time in `mcp-host.ts`; this returns the
 * tool's structural metadata so products/tests can inspect it.
 */
export function coldMemoryToolSpec(): {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
} {
  return {
    name: 'query_history',
    description:
      'Read-only SQL query against the platform data store (Dolt). Only SELECT / WITH statements are permitted. Returns at most a platform-enforced row limit.',
    inputSchema: z.object({
      sql: z.string().min(1),
    }),
  };
}
