import { execFile } from 'node:child_process';

export interface GhRunOptions {
  /** Data written to gh's stdin (e.g. for `gh api --input -`). */
  input?: string;
}

/** Runs the `gh` CLI with the given arguments and returns stdout. */
export type GhRunner = (args: string[], options?: GhRunOptions) => Promise<string>;

export class GhError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GhError';
  }
}

const MAX_BUFFER = 256 * 1024 * 1024;

export function createGhRunner(cwd: string): GhRunner {
  return (args, options) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(
        'gh',
        args,
        { cwd, maxBuffer: MAX_BUFFER, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
        (error, stdout, stderr) => {
          if (error) {
            const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null;
            const detail = stderr.trim() || error.message;
            reject(new GhError(`gh ${args.slice(0, 2).join(' ')} failed: ${detail}`, args, stderr, code));
            return;
          }
          resolve(stdout);
        },
      );
      if (options?.input !== undefined) {
        child.stdin?.end(options.input);
      } else {
        child.stdin?.end();
      }
    });
}

export async function ghJson<T>(gh: GhRunner, args: string[], options?: GhRunOptions): Promise<T> {
  const out = await gh(args, options);
  if (out.trim() === '') {
    return null as T;
  }
  return JSON.parse(out) as T;
}
