import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the base data directory for prviewer.
 * Honors $PRVIEWER_DATA_DIR, then $XDG_DATA_HOME, then ~/.local/share.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PRVIEWER_DATA_DIR) return env.PRVIEWER_DATA_DIR;
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'prviewer');
}

function safeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function prStatePath(dataDir: string, owner: string, name: string, number: number): string {
  return path.join(dataDir, safeSegment(owner), safeSegment(name), `pr-${number}.json`);
}
