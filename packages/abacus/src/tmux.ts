import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TmuxSpawnParams {
  session: string;
  cwd: string;
  logFile: string;
  command: string;
}

async function runTmux(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

export class Tmux {
  async spawn(params: TmuxSpawnParams): Promise<void> {
    await runTmux(['new-session', '-d', '-s', params.session, '-c', params.cwd, params.command]);
    await runTmux([
      'pipe-pane',
      '-t',
      params.session,
      '-o',
      `cat >> '${params.logFile.replace(/'/g, "'\\''")}'`,
    ]);
  }

  async kill(session: string): Promise<void> {
    try {
      await runTmux(['kill-session', '-t', session]);
    } catch {
      // session may have already exited; that's fine
    }
  }

  async exists(session: string): Promise<boolean> {
    try {
      await runTmux(['has-session', '-t', `=${session}`]);
      return true;
    } catch (err) {
      const msg = (err as NodeJS.ErrnoException).message ?? '';
      if (/can't find|no server running|session not found/i.test(msg)) return false;
      throw err;
    }
  }
}
