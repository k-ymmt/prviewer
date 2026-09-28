import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodexThread, PRPersistedState } from '../../shared/types.js';
import { prStatePath } from './paths.js';

export function emptyState(): PRPersistedState {
  return {
    version: 1,
    viewed: { commits: {}, commitFiles: {}, files: {} },
    codexThreads: [],
  };
}

export { commitFileKey, viewedOps } from '../../shared/viewed.js';

export interface PRStore {
  load(): Promise<PRPersistedState>;
  /** Applies `update` to the current state and persists the result. Updates are serialized. */
  update<T>(update: (state: PRPersistedState) => { state: PRPersistedState; result: T }): Promise<T>;
}

function normalize(raw: unknown): PRPersistedState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<PRPersistedState>;
  const viewed = r.viewed ?? base.viewed;
  return {
    version: 1,
    viewed: {
      commits: viewed.commits ?? {},
      commitFiles: viewed.commitFiles ?? {},
      files: viewed.files ?? {},
    },
    codexThreads: Array.isArray(r.codexThreads) ? (r.codexThreads as CodexThread[]) : [],
  };
}

export class FilePRStore implements PRStore {
  private queue: Promise<unknown> = Promise.resolve();
  private cache: PRPersistedState | null = null;

  constructor(private readonly filePath: string) {}

  async load(): Promise<PRPersistedState> {
    if (this.cache) return this.cache;
    try {
      const text = await readFile(this.filePath, 'utf8');
      this.cache = normalize(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`prviewer: could not read ${this.filePath}, starting from empty state:`, error);
      }
      this.cache = emptyState();
    }
    return this.cache;
  }

  update<T>(update: (state: PRPersistedState) => { state: PRPersistedState; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const current = await this.load();
      const { state, result } = update(current);
      await this.persist(state);
      this.cache = state;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async persist(state: PRPersistedState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}

export interface StoreRegistry {
  forPR(number: number): PRStore;
}

export function createFileStoreRegistry(dataDir: string, owner: string, name: string): StoreRegistry {
  const stores = new Map<number, PRStore>();
  return {
    forPR(number) {
      let store = stores.get(number);
      if (!store) {
        store = new FilePRStore(prStatePath(dataDir, owner, name, number));
        stores.set(number, store);
      }
      return store;
    },
  };
}

/** In-memory registry used by tests. */
export function createMemoryStoreRegistry(): StoreRegistry {
  const stores = new Map<number, PRStore>();
  return {
    forPR(number) {
      let store = stores.get(number);
      if (!store) {
        let state = emptyState();
        store = {
          load: async () => state,
          update: async (fn) => {
            const out = fn(state);
            state = out.state;
            return out.result;
          },
        };
        stores.set(number, store);
      }
      return store;
    },
  };
}
