import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prStatePath, resolveDataDir } from '../../src/server/store/paths';
import { FilePRStore, createFileStoreRegistry } from '../../src/server/store/prStore';
import { viewedOps } from '../../src/shared/viewed';

describe('paths', () => {
  it('prefers PRVIEWER_DATA_DIR, then XDG_DATA_HOME, then ~/.local/share', () => {
    expect(resolveDataDir({ PRVIEWER_DATA_DIR: '/custom' })).toBe('/custom');
    expect(resolveDataDir({ XDG_DATA_HOME: '/xdg' })).toBe(path.join('/xdg', 'prviewer'));
    expect(resolveDataDir({})).toBe(path.join(os.homedir(), '.local', 'share', 'prviewer'));
  });

  it('sanitizes owner and repo names in state paths', () => {
    expect(prStatePath('/data', 'own/er', 'na me', 12)).toBe(path.join('/data', 'own_er', 'na_me', 'pr-12.json'));
  });
});

describe('FilePRStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'prviewer-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty and persists updates to disk', async () => {
    const file = path.join(dir, 'nested', 'pr-1.json');
    const store = new FilePRStore(file);
    expect(await store.load()).toEqual({ version: 1, viewed: { commits: {}, commitFiles: {}, files: {} }, codexThreads: [] });

    await store.update((s) => ({ state: { ...s, viewed: viewedOps.setCommitViewed(s.viewed, 'abc', true) }, result: null }));
    const raw = JSON.parse(await readFile(file, 'utf8')) as { viewed: { commits: Record<string, true> } };
    expect(raw.viewed.commits).toEqual({ abc: true });

    // A fresh store instance (simulating a server restart) reads the persisted state back.
    const reloaded = new FilePRStore(file);
    expect((await reloaded.load()).viewed.commits).toEqual({ abc: true });
  });

  it('serializes concurrent updates', async () => {
    const store = new FilePRStore(path.join(dir, 'pr-2.json'));
    await Promise.all(
      ['a', 'b', 'c'].map((sha) =>
        store.update((s) => ({ state: { ...s, viewed: viewedOps.setCommitViewed(s.viewed, sha, true) }, result: null })),
      ),
    );
    expect(Object.keys((await store.load()).viewed.commits).sort()).toEqual(['a', 'b', 'c']);
  });

  it('tolerates corrupt files by starting from an empty state', async () => {
    const file = path.join(dir, 'pr-3.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{not json', 'utf8');
    const store = new FilePRStore(file);
    expect((await store.load()).codexThreads).toEqual([]);
  });

  it('registry returns the same store per PR number', () => {
    const registry = createFileStoreRegistry(dir, 'o', 'r');
    expect(registry.forPR(1)).toBe(registry.forPR(1));
    expect(registry.forPR(1)).not.toBe(registry.forPR(2));
  });
});
