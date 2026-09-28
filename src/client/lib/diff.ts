import type { DiffSide } from '../../shared/types';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const LANG_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  toml: 'ini',
  ini: 'ini',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  dart: 'dart',
  scala: 'scala',
  vue: 'vue',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  diff: 'diff',
  patch: 'diff',
  proto: 'protobuf',
  tf: 'ini',
  m: 'objectivec',
  mm: 'objectivec',
};

/** Guesses a highlight.js language name from a file path. */
export function languageForPath(filePath: string): string | undefined {
  const base = filePath.split('/').pop() ?? filePath;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile') return 'makefile';
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return LANG_BY_EXTENSION[ext];
}

export interface DiffSelectionText {
  selectedText: string;
  hunk: string;
}

/**
 * Extracts the source text for a line range on one side of a GitHub-style patch,
 * along with the hunk(s) that contain those lines.
 */
export function extractSelection(patch: string, side: DiffSide, startLine: number, endLine: number): DiffSelectionText {
  const lines = patch.split('\n');
  const selected: string[] = [];
  const hunks: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let currentHunk: string[] = [];
  let hunkTouched = false;

  const flushHunk = () => {
    if (currentHunk.length > 0 && hunkTouched) hunks.push(currentHunk.join('\n'));
    currentHunk = [];
    hunkTouched = false;
  };

  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      flushHunk();
      oldLine = Number.parseInt(header[1] ?? '0', 10);
      newLine = Number.parseInt(header[3] ?? '0', 10);
      currentHunk.push(line);
      continue;
    }
    currentHunk.push(line);
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const marker = line.charAt(0);
    const text = line.slice(1);
    let lineNumber: number | null = null;
    if (marker === '+') {
      lineNumber = side === 'new' ? newLine : null;
      newLine += 1;
    } else if (marker === '-') {
      lineNumber = side === 'old' ? oldLine : null;
      oldLine += 1;
    } else {
      lineNumber = side === 'new' ? newLine : oldLine;
      oldLine += 1;
      newLine += 1;
    }
    if (lineNumber !== null && lineNumber >= startLine && lineNumber <= endLine) {
      selected.push(text);
      hunkTouched = true;
    }
  }
  flushHunk();
  return { selectedText: selected.join('\n'), hunk: hunks.join('\n') };
}

/** Counts the number of hunks in a patch (used to size lazily rendered placeholders). */
export function countPatchLines(patch: string | null): number {
  if (!patch) return 0;
  return patch.split('\n').length;
}

/**
 * GitHub's REST API returns only the hunks of a patch, while the diff parser expects a
 * `---`/`+++` header. This wraps the hunks in a minimal git-style header.
 */
export function toGitDiff(file: { path: string; previousPath: string | null; status: string; patch: string }): string {
  const oldPath = file.previousPath ?? file.path;
  const oldLabel = file.status === 'added' ? '/dev/null' : `a/${oldPath}`;
  const newLabel = file.status === 'removed' ? '/dev/null' : `b/${file.path}`;
  return `diff --git a/${oldPath} b/${file.path}\n--- ${oldLabel}\n+++ ${newLabel}\n${file.patch}`;
}
