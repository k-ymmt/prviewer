import { describe, expect, it } from 'vitest';
import { extractSelection, languageForPath, toGitDiff } from '../../src/client/lib/diff';

const patch = [
  '@@ -1,4 +1,5 @@',
  ' line1',
  '-old2',
  '+new2',
  '+new3',
  ' line4',
  '@@ -10,2 +11,2 @@ function f() {',
  ' ctx',
  '-removed',
  '+added',
  '\\ No newline at end of file',
].join('\n');

describe('extractSelection', () => {
  it('extracts new-side lines and only the touched hunk', () => {
    const result = extractSelection(patch, 'new', 2, 3);
    expect(result.selectedText).toBe('new2\nnew3');
    expect(result.hunk).toBe('@@ -1,4 +1,5 @@\n line1\n-old2\n+new2\n+new3\n line4');
  });

  it('extracts old-side lines across hunks', () => {
    const result = extractSelection(patch, 'old', 2, 11);
    expect(result.selectedText).toBe('old2\nline4\nctx\nremoved');
    expect(result.hunk.split('\n').filter((l) => l.startsWith('@@'))).toHaveLength(2);
  });

  it('maps context lines using the requested side numbering', () => {
    expect(extractSelection(patch, 'new', 4, 4).selectedText).toBe('line4');
    expect(extractSelection(patch, 'old', 3, 3).selectedText).toBe('line4');
    expect(extractSelection(patch, 'new', 99, 100)).toEqual({ selectedText: '', hunk: '' });
  });
});

describe('languageForPath', () => {
  it('guesses languages from extensions and special file names', () => {
    expect(languageForPath('src/App.tsx')).toBe('tsx');
    expect(languageForPath('lib/x.rb')).toBe('ruby');
    expect(languageForPath('Dockerfile')).toBe('dockerfile');
    expect(languageForPath('README')).toBeUndefined();
  });
});

describe('toGitDiff', () => {
  it('adds a git-style header so the diff parser accepts GitHub patches', () => {
    expect(toGitDiff({ path: 'a.ts', previousPath: null, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' })).toBe(
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b',
    );
    expect(toGitDiff({ path: 'n.ts', previousPath: null, status: 'added', patch: '@@' })).toContain('--- /dev/null\n+++ b/n.ts');
    expect(toGitDiff({ path: 'n.ts', previousPath: 'o.ts', status: 'renamed', patch: '@@' })).toContain(
      'diff --git a/o.ts b/n.ts\n--- a/o.ts\n+++ b/n.ts',
    );
    expect(toGitDiff({ path: 'd.ts', previousPath: null, status: 'removed', patch: '@@' })).toContain('+++ /dev/null');
  });
});
