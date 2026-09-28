import type { ViewedState } from './types.js';

export function commitFileKey(sha: string, filePath: string): string {
  return `${sha}:${filePath}`;
}

/** Pure state transitions for the "viewed" bookkeeping. Shared by the server store and the client cache. */
export const viewedOps = {
  setCommitViewed(state: ViewedState, sha: string, viewed: boolean): ViewedState {
    const commits = { ...state.commits };
    if (viewed) commits[sha] = true;
    else delete commits[sha];
    return { ...state, commits };
  },

  /**
   * Marks a single file inside a commit as viewed. When `allPaths` is provided and every one of them
   * is viewed afterwards, the commit itself is marked as viewed too.
   */
  setCommitFileViewed(state: ViewedState, sha: string, filePath: string, viewed: boolean, allPaths?: string[]): ViewedState {
    const commitFiles = { ...state.commitFiles };
    const key = commitFileKey(sha, filePath);
    if (viewed) commitFiles[key] = true;
    else delete commitFiles[key];
    let next: ViewedState = { ...state, commitFiles };
    if (viewed && allPaths && allPaths.length > 0) {
      const allViewed = allPaths.every((p) => commitFiles[commitFileKey(sha, p)]);
      if (allViewed) next = viewedOps.setCommitViewed(next, sha, true);
    }
    return next;
  },

  isCommitFileViewed(state: ViewedState, sha: string, filePath: string): boolean {
    return state.commitFiles[commitFileKey(sha, filePath)] === true;
  },

  setFileViewed(state: ViewedState, filePath: string, blobSha: string, viewed: boolean, now = new Date()): ViewedState {
    const files = { ...state.files };
    if (viewed) files[filePath] = { blobSha, viewedAt: now.toISOString() };
    else delete files[filePath];
    return { ...state, files };
  },

  fileViewedStatus(state: ViewedState, filePath: string, blobSha: string): { viewed: boolean; changedSinceViewed: boolean } {
    const entry = state.files[filePath];
    if (!entry) return { viewed: false, changedSinceViewed: false };
    if (entry.blobSha === blobSha) return { viewed: true, changedSinceViewed: false };
    return { viewed: false, changedSinceViewed: true };
  },
};
