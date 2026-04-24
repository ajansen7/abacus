#!/usr/bin/env tsx
/**
 * Platform-purity lint. For every `packages/<product>/.platform-denylist`, scan
 * `packages/abacus/src/` for whole-word matches (case-insensitive). Any match
 * exits non-zero.
 *
 * Platform code must not reference any product domain — the denylist per
 * product is the product's own declaration of which tokens leak its identity.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

interface Denylist {
  product: string;
  tokens: string[];
}

async function readDenylist(productDir: string): Promise<Denylist | null> {
  const path = join(productDir, '.platform-denylist');
  try {
    await stat(path);
  } catch {
    return null;
  }
  const raw = await readFile(path, 'utf8');
  const tokens: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    tokens.push(trimmed);
  }
  return { product: productDir.split('/').pop() ?? productDir, tokens };
}

async function collectDenylists(packagesDir: string): Promise<Denylist[]> {
  const root = resolve(packagesDir);
  const lists: Denylist[] = [];
  const entries = await readdir(root);
  for (const name of entries) {
    const dir = join(root, name);
    const s = await stat(dir);
    if (!s.isDirectory()) continue;
    if (name === 'abacus') continue;
    const list = await readDenylist(dir);
    if (list) lists.push(list);
  }
  return lists;
}

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const s = await stat(path);
    if (s.isDirectory()) {
      out.push(...(await walkTs(path)));
    } else if (name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

function tokenPattern(token: string): RegExp {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i');
}

interface Violation {
  file: string;
  line: number;
  product: string;
  token: string;
  snippet: string;
}

async function main(): Promise<void> {
  const lists = await collectDenylists('packages');
  if (lists.length === 0) {
    console.log('platform-purity: no .platform-denylist files found — nothing to scan');
    return;
  }

  const files = await walkTs(resolve('packages/abacus/src'));
  const violations: Violation[] = [];

  for (const file of files) {
    const src = await readFile(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      for (const list of lists) {
        for (const token of list.tokens) {
          if (tokenPattern(token).test(line)) {
            violations.push({
              file: relative(process.cwd(), file),
              line: i + 1,
              product: list.product,
              token,
              snippet: line.trim(),
            });
          }
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `platform-purity: ok — scanned ${files.length} file(s) against ${lists.length} denylist(s)`,
    );
    return;
  }

  console.error(`platform-purity: ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.product}:${v.token}]  ${v.snippet}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('platform-purity: fatal', err);
  process.exit(2);
});
