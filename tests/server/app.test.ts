import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { GhRunner } from '../../src/server/gh';
import { createMemoryStoreRegistry } from '../../src/server/store/prStore';

interface Call {
  args: string[];
  input?: string;
}

function fakeGh(responses: Record<string, unknown>): { gh: GhRunner; calls: Call[] } {
  const calls: Call[] = [];
  const gh: GhRunner = async (args, options) => {
    calls.push({ args, input: options?.input });
    const key = args.join(' ');
    for (const [pattern, value] of Object.entries(responses)) {
      if (key.includes(pattern)) return typeof value === 'string' ? value : JSON.stringify(value);
    }
    throw new Error(`unexpected gh call: ${key}`);
  };
  return { gh, calls };
}

const commitPayload = {
  sha: 'c0ffee1234567890',
  html_url: 'https://github.com/octo/repo/commit/c0ffee',
  commit: { message: 'Fix bug\n\nDetails', author: { name: 'Octo', date: '2026-01-01T00:00:00Z' }, committer: null },
  author: { login: 'octo', avatar_url: 'https://avatars/octo' },
  parents: [{ sha: 'parent' }],
  files: [
    { filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, sha: 'blobA', patch: '@@ -1 +1 @@\n-a\n+b' },
    {
      filename: 'b.ts',
      status: 'added',
      additions: 3,
      deletions: 0,
      changes: 3,
      sha: 'blobB',
      patch: '@@ -0,0 +1,3 @@\n+1\n+2\n+3',
    },
  ],
  stats: { additions: 4, deletions: 1, total: 5 },
};

function makeApp(responses: Record<string, unknown>) {
  const { gh, calls } = fakeGh(responses);
  const app = createApp({
    gh,
    repo: { owner: 'octo', name: 'repo', nameWithOwner: 'octo/repo', url: 'https://github.com/octo/repo' },
    viewerLogin: 'me',
    repoRoot: '/repo',
    stores: createMemoryStoreRegistry(),
    codex: null,
    clientDir: null,
  });
  return { app, calls };
}

describe('createApp', () => {
  it('serves repository info', async () => {
    const { app } = makeApp({});
    const res = await app.request('/api/repo');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nameWithOwner: 'octo/repo', viewerLogin: 'me', codexAvailable: false });
  });

  it('lists pull requests with the default filter and a custom query', async () => {
    const { app, calls } = makeApp({ 'pr list': [] });
    const res = await app.request('/api/prs');
    expect(await res.json()).toEqual({ query: 'is:open review-requested:@me', items: [] });
    expect(calls[0]?.args).toContain('--search');
    expect(calls[0]?.args).toContain('is:open review-requested:@me');

    await app.request('/api/prs?q=');
    expect(calls[1]?.args).not.toContain('--search');

    await app.request(`/api/prs?q=${encodeURIComponent('is:open author:@me')}`);
    expect(calls[2]?.args).toContain('is:open author:@me');
  });

  it('marks a commit as viewed once all of its files are viewed, through the API', async () => {
    const { app, calls } = makeApp({
      'repos/octo/repo/commits/c0ffee1234567890/comments': [],
      'repos/octo/repo/commits/c0ffee1234567890': commitPayload,
    });
    const put = (body: unknown) =>
      app.request('/api/prs/5/viewed/commit-files', {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

    let res = await put({ sha: 'c0ffee1234567890', path: 'a.ts', viewed: true });
    expect(res.status).toBe(200);
    let viewed = (await res.json()) as { commits: Record<string, true>; commitFiles: Record<string, true> };
    expect(viewed.commits).toEqual({});

    res = await put({ sha: 'c0ffee1234567890', path: 'b.ts', viewed: true });
    viewed = (await res.json()) as { commits: Record<string, true>; commitFiles: Record<string, true> };
    expect(viewed.commits).toEqual({ c0ffee1234567890: true });

    // The commit detail was fetched once and cached.
    expect(calls.filter((c) => c.args.join(' ').endsWith('repos/octo/repo/commits/c0ffee1234567890'))).toHaveLength(1);

    const state = await app.request('/api/prs/5/state');
    expect(((await state.json()) as { viewed: { commits: Record<string, true> } }).viewed.commits).toEqual({
      c0ffee1234567890: true,
    });
  });

  it('validates viewed requests', async () => {
    const { app } = makeApp({});
    const res = await app.request('/api/prs/5/viewed/files', {
      method: 'PUT',
      body: JSON.stringify({ path: 'x', viewed: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'blobSha is required' });
    const bad = await app.request('/api/prs/abc');
    expect(bad.status).toBe(400);
  });

  it('posts review comments through gh api with a JSON body', async () => {
    const { app, calls } = makeApp({ 'pulls/5/comments': '' });
    const res = await app.request('/api/prs/5/review-comments', {
      method: 'POST',
      body: JSON.stringify({
        body: 'nice',
        path: 'a.ts',
        line: 4,
        side: 'RIGHT',
        startLine: 2,
        startSide: 'RIGHT',
        commitId: 'headsha',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call?.args).toEqual(['api', '-X', 'POST', 'repos/octo/repo/pulls/5/comments', '--input', '-']);
    expect(JSON.parse(call?.input ?? '{}')).toEqual({
      body: 'nice',
      commit_id: 'headsha',
      path: 'a.ts',
      line: 4,
      side: 'RIGHT',
      start_line: 2,
      start_side: 'RIGHT',
    });
  });

  it('requires a body for non-approving reviews', async () => {
    const { app, calls } = makeApp({ 'pulls/5/reviews': '' });
    const bad = await app.request('/api/prs/5/reviews', {
      method: 'POST',
      body: JSON.stringify({ event: 'REQUEST_CHANGES', body: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(bad.status).toBe(400);
    const ok = await app.request('/api/prs/5/reviews', {
      method: 'POST',
      body: JSON.stringify({ event: 'APPROVE', body: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(calls[0]?.input ?? '{}')).toEqual({ event: 'APPROVE', body: '' });
  });

  it('returns 503 for codex endpoints when codex is unavailable', async () => {
    const { app } = makeApp({});
    const res = await app.request('/api/prs/5/codex/threads', {
      method: 'POST',
      body: JSON.stringify({ question: 'q', scope: { kind: 'pr' }, selection: { path: 'a' } }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(503);
  });

  it('maps unexpected failures to 500', async () => {
    const { app } = makeApp({});
    const res = await app.request('/api/prs/5/commits');
    expect(res.status).toBe(500);
  });
});
