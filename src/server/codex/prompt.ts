import type { CodexScope, CodexSelection } from '../../shared/types.js';

export interface PromptContext {
  repo: string;
  prNumber: number;
  prTitle: string;
  headSha: string;
  baseRefName: string;
  headRefName: string;
  scope: CodexScope;
  selection: CodexSelection;
}

function lineRange(selection: CodexSelection): string {
  return selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine}-${selection.endLine}`;
}

/** Builds the first prompt of a thread. It carries all the context codex needs about the selection. */
export function buildInitialPrompt(ctx: PromptContext, question: string): string {
  const revision = ctx.scope.kind === 'commit' ? ctx.scope.sha : ctx.headSha;
  const scopeLabel =
    ctx.scope.kind === 'commit'
      ? `commit ${ctx.scope.sha.slice(0, 7)} of pull request #${ctx.prNumber}`
      : `pull request #${ctx.prNumber} (all changes, head ${ctx.headSha.slice(0, 7)})`;
  const sideLabel = ctx.selection.side === 'new' ? 'the new (right) side' : 'the old (left) side';
  return [
    `You are helping a reviewer read ${scopeLabel} in the GitHub repository ${ctx.repo}.`,
    `PR title: ${ctx.prTitle}`,
    `Branches: ${ctx.headRefName} -> ${ctx.baseRefName}`,
    '',
    `The reviewer selected ${lineRange(ctx.selection)} on ${sideLabel} of the diff for \`${ctx.selection.path}\`.`,
    '',
    'Selected lines:',
    '```',
    ctx.selection.selectedText,
    '```',
    '',
    'Surrounding diff hunk:',
    '```diff',
    ctx.selection.hunk,
    '```',
    '',
    'Notes:',
    `- Your working directory is a local checkout of this repository, but it may not be checked out at the PR revision (${revision}).`,
    `- Prefer the diff above as the source of truth. If you need more context, you may run read-only git commands such as \`git show ${revision}:${ctx.selection.path}\` when that object is available locally.`,
    '- Do not modify any files. Answer concisely in Markdown, and quote code only when it helps.',
    '',
    'Question:',
    question,
  ].join('\n');
}

/** Follow-up prompts only carry the new question; the thread already has the context. */
export function buildFollowUpPrompt(question: string): string {
  return question;
}
