import { describe, expect, it } from 'vitest';
import type { ViewedState } from '../../src/shared/types';
import { commitFileKey, viewedOps } from '../../src/shared/viewed';

const empty = (): ViewedState => ({ commits: {}, commitFiles: {}, files: {} });

describe('viewedOps', () => {
  it('toggles commit viewed state', () => {
    const on = viewedOps.setCommitViewed(empty(), 'abc', true);
    expect(on.commits).toEqual({ abc: true });
    const off = viewedOps.setCommitViewed(on, 'abc', false);
    expect(off.commits).toEqual({});
  });

  it('marks the commit as viewed once every file of the commit is viewed', () => {
    const paths = ['a.ts', 'b.ts'];
    let state = viewedOps.setCommitFileViewed(empty(), 'sha1', 'a.ts', true, paths);
    expect(state.commits).toEqual({});
    expect(state.commitFiles[commitFileKey('sha1', 'a.ts')]).toBe(true);
    state = viewedOps.setCommitFileViewed(state, 'sha1', 'b.ts', true, paths);
    expect(state.commits).toEqual({ sha1: true });
  });

  it('keeps commit and file viewed states independent when un-viewing a file', () => {
    const paths = ['a.ts'];
    let state = viewedOps.setCommitFileViewed(empty(), 'sha1', 'a.ts', true, paths);
    expect(state.commits.sha1).toBe(true);
    state = viewedOps.setCommitFileViewed(state, 'sha1', 'a.ts', false, paths);
    expect(state.commitFiles).toEqual({});
    expect(state.commits.sha1).toBe(true);
  });

  it('does not touch the commit flag when the file list is unknown', () => {
    const state = viewedOps.setCommitFileViewed(empty(), 'sha1', 'a.ts', true);
    expect(state.commits).toEqual({});
  });

  it('records the blob sha for PR-level files and detects later changes', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = viewedOps.setFileViewed(empty(), 'src/x.ts', 'blob1', true, now);
    expect(state.files['src/x.ts']).toEqual({ blobSha: 'blob1', viewedAt: now.toISOString() });
    expect(viewedOps.fileViewedStatus(state, 'src/x.ts', 'blob1')).toEqual({ viewed: true, changedSinceViewed: false });
    expect(viewedOps.fileViewedStatus(state, 'src/x.ts', 'blob2')).toEqual({ viewed: false, changedSinceViewed: true });
    expect(viewedOps.fileViewedStatus(state, 'other.ts', 'blob1')).toEqual({ viewed: false, changedSinceViewed: false });
    expect(viewedOps.setFileViewed(state, 'src/x.ts', 'blob1', false).files).toEqual({});
  });
});
