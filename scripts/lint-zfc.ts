#!/usr/bin/env tsx
/**
 * Zero Framework Cognition lint. Scans `packages/abacus/src/` for patterns that
 * would represent payload-content branching inside platform code. Any match
 * exits non-zero. See CLAUDE.md tenet 3 and `packages/abacus/claude.md`.
 *
 * Philosophy: the platform treats `payload` as opaque. It may be validated at
 * the boundary, forwarded to the runner, or stored — never read into branching
 * logic. The patterns below are textual approximations; cleverer violations may
 * slip through, but the cost-of-writing-a-ZFC-violation stays meaningfully high.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

interface Rule {
  id: string;
  description: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: 'payload-property-access',
    description: 'platform code must not read named properties off a payload',
    pattern: /(?<![a-zA-Z_.])payload\.[a-zA-Z_]/g,
  },
  {
    id: 'payload-indexed-access',
    description: 'platform code must not index into payload',
    pattern: /(?<![a-zA-Z_.])payload\[/g,
  },
  {
    id: 'payload-equality',
    description: 'platform code must not compare payload against literal content',
    pattern: /(?<![a-zA-Z_.])payload\s*[=!]==?/g,
  },
  {
    id: 'product-literal-branch',
    description: 'platform code must not branch on a product-name literal',
    pattern: /\bproduct\s*===\s*['"][a-z]/g,
  },
];

const EXEMPT_MARKER = 'zfc-allow';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const s = await stat(path);
    if (s.isDirectory()) {
      out.push(...(await walk(path)));
    } else if (name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  rule: Rule;
  snippet: string;
}

async function main(): Promise<void> {
  const root = resolve('packages/abacus/src');
  const files = await walk(root);
  const violations: Violation[] = [];

  for (const file of files) {
    const src = await readFile(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (line.includes(EXEMPT_MARKER)) continue;
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(line)) {
          violations.push({
            file: relative(process.cwd(), file),
            line: i + 1,
            rule,
            snippet: line.trim(),
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(`zfc-lint: ok — scanned ${files.length} file(s)`);
    return;
  }

  console.error(`zfc-lint: ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule.id}]  ${v.snippet}`);
    console.error(`    ${v.rule.description}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('zfc-lint: fatal', err);
  process.exit(2);
});
