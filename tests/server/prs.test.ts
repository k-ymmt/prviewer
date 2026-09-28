import { describe, expect, it } from 'vitest';
import { buildPrListArgs, mapPullRequestDetail, toChangedFile } from '../../src/server/github/prs';

describe('buildPrListArgs', () => {
  it('passes the search query to gh and lists all states so the query controls filtering', () => {
    const args = buildPrListArgs({ owner: 'o', name: 'r' }, 'is:open review-requested:@me', 25);
    expect(args.slice(0, 4)).toEqual(['pr', 'list', '--repo', 'o/r']);
    expect(args).toContain('--state');
    expect(args[args.indexOf('--state') + 1]).toBe('all');
    expect(args[args.indexOf('--search') + 1]).toBe('is:open review-requested:@me');
    expect(args[args.indexOf('--limit') + 1]).toBe('25');
  });

  it('omits --search for an empty query', () => {
    expect(buildPrListArgs({ owner: 'o', name: 'r' }, '   ', 10)).not.toContain('--search');
  });
});

describe('toChangedFile', () => {
  it('normalizes unknown statuses and missing patches', () => {
    const file = toChangedFile({ filename: 'x.bin', status: 'weird', additions: 0, deletions: 0, changes: 0, sha: 'abc' });
    expect(file).toEqual({
      path: 'x.bin',
      previousPath: null,
      status: 'modified',
      additions: 0,
      deletions: 0,
      changes: 0,
      sha: 'abc',
      patch: null,
    });
  });
});

describe('mapPullRequestDetail', () => {
  it('builds a chronological timeline and review threads', () => {
    const detail = mapPullRequestDetail({
      id: 'PR_1',
      number: 3,
      title: 'T',
      body: 'b',
      bodyHTML: '<p>b</p>',
      state: 'OPEN',
      isDraft: false,
      url: 'u',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      mergedAt: null,
      closedAt: null,
      author: { login: 'alice', avatarUrl: 'a' },
      baseRefName: 'main',
      headRefName: 'feat',
      headRefOid: 'deadbeef',
      additions: 1,
      deletions: 2,
      changedFiles: 1,
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'MERGEABLE',
      labels: { nodes: [] },
      assignees: { nodes: [] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'bob', avatarUrl: 'b' } }, { requestedReviewer: null }] },
      latestReviews: { nodes: [] },
      commits: { totalCount: 2 },
      comments: {
        nodes: [
          {
            id: 'c2',
            databaseId: 2,
            author: null,
            body: 'later',
            bodyHTML: '<p>later</p>',
            createdAt: '2026-01-01T10:00:00Z',
            url: 'u2',
          },
        ],
      },
      reviews: {
        nodes: [
          {
            id: 'r1',
            databaseId: 1,
            author: { login: 'bob', avatarUrl: 'b' },
            state: 'APPROVED',
            body: '',
            bodyHTML: '',
            submittedAt: '2026-01-01T05:00:00Z',
            url: 'ur',
            comments: { nodes: [] },
          },
          {
            id: 'r2',
            databaseId: 2,
            author: { login: 'bob', avatarUrl: 'b' },
            state: 'PENDING',
            body: 'draft',
            bodyHTML: '<p>draft</p>',
            submittedAt: null,
            url: 'ur2',
            comments: { nodes: [] },
          },
        ],
      },
      reviewThreads: {
        nodes: [
          {
            id: 't1',
            isResolved: false,
            isOutdated: false,
            path: 'a.ts',
            line: 10,
            startLine: null,
            diffSide: 'RIGHT',
            startDiffSide: null,
            comments: {
              nodes: [
                {
                  id: 'rc1',
                  databaseId: 11,
                  author: { login: 'bob', avatarUrl: 'b' },
                  body: 'hm',
                  bodyHTML: '<p>hm</p>',
                  createdAt: '2026-01-01T06:00:00Z',
                  url: 'x',
                  path: 'a.ts',
                  line: 10,
                  startLine: null,
                  originalLine: 10,
                  diffHunk: '@@',
                  outdated: false,
                  replyTo: null,
                },
              ],
            },
          },
        ],
      },
    });
    expect(detail.timeline.map((e) => e.id)).toEqual(['r1', 'c2']);
    expect(detail.timeline[0]).toMatchObject({ kind: 'review', state: 'APPROVED' });
    expect(detail.reviewRequests).toEqual([{ login: 'bob', avatarUrl: 'b' }]);
    expect(detail.reviewThreads[0]).toMatchObject({ path: 'a.ts', line: 10, diffSide: 'RIGHT' });
    expect(detail.reviewThreads[0]?.comments[0]).toMatchObject({ databaseId: 11, replyToId: null });
    expect(detail.author).toEqual({ login: 'alice', avatarUrl: 'a' });
    expect(detail.commitCount).toBe(2);
  });
});
