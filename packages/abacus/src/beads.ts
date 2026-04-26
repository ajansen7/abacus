import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const BdIssueRaw = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    status: z.string().optional(),
    labels: z.array(z.string()).default([]),
    metadata: z.unknown().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export type BdIssue = z.infer<typeof BdIssueRaw>;

export interface BeadsOptions {
  cwd?: string;
  bin?: string;
}

export class Beads {
  private readonly cwd: string;
  private readonly bin: string;

  constructor(opts: BeadsOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.bin = opts.bin ?? 'bd';
  }

  private async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.bin, args, {
      cwd: this.cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }

  async create(params: {
    title: string;
    labels: string[];
    metadata: Record<string, unknown>;
    description?: string;
  }): Promise<string> {
    const args = [
      '--json',
      'create',
      params.title,
      '--type',
      'task',
      '--labels',
      params.labels.join(','),
      '--metadata',
      JSON.stringify(params.metadata),
    ];
    if (params.description) {
      args.push('--description', params.description);
    }
    const out = (await this.run(args)).trim();
    if (!out) throw new Error('bd create returned empty output');
    const parsed: unknown = JSON.parse(out);
    return z.object({ id: z.string() }).passthrough().parse(parsed).id;
  }

  async list(labels?: string[]): Promise<BdIssue[]> {
    const args = ['--json', 'list', '--limit', '0'];
    if (labels && labels.length > 0) {
      args.push('--label-any', labels.join(','));
    }
    const out = (await this.run(args)).trim();
    if (!out) return [];
    const parsed: unknown = JSON.parse(out);
    const arr = z.array(BdIssueRaw).safeParse(parsed);
    if (arr.success) return arr.data;
    const wrapped = z.object({ issues: z.array(BdIssueRaw) }).safeParse(parsed);
    if (wrapped.success) return wrapped.data.issues;
    throw new Error(`bd list returned unexpected shape: ${out.slice(0, 200)}`);
  }

  async show(id: string): Promise<BdIssue> {
    const out = (await this.run(['--json', 'show', id])).trim();
    const parsed: unknown = JSON.parse(out);
    const direct = BdIssueRaw.safeParse(parsed);
    if (direct.success) return direct.data;
    const arr = z.array(BdIssueRaw).min(1).safeParse(parsed);
    if (arr.success) return arr.data[0]!;
    throw new Error(`bd show returned unexpected shape: ${out.slice(0, 200)}`);
  }

  async updateMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
    const args = ['update', id];
    for (const [key, value] of Object.entries(patch)) {
      const encoded = typeof value === 'string' ? value : JSON.stringify(value);
      args.push('--set-metadata', `${key}=${encoded}`);
    }
    await this.run(args);
  }

  async close(id: string): Promise<void> {
    await this.run(['close', id]);
  }
}
