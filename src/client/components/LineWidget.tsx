import { useState } from 'react';
import { Button, SegmentedControl, Textarea } from '@primer/react';
import { CommentIcon, CopilotIcon } from '@primer/octicons-react';
import type { CodexScope, DiffSide } from '../../shared/types';
import { useCreateCodexThread, useCreateReviewComment } from '../api/hooks';
import { extractSelection } from '../lib/diff';

export interface LineWidgetProps {
  prNumber: number;
  path: string;
  patch: string;
  side: DiffSide;
  fromLine: number;
  toLine: number;
  scope: CodexScope;
  /** Commit id used for GitHub review comments; null disables GitHub comments. */
  commentCommitId: string | null;
  codexAvailable: boolean;
  onClose: () => void;
}

type Mode = 'codex' | 'comment';

export function LineWidget(props: LineWidgetProps) {
  const { prNumber, path, patch, side, fromLine, toLine, scope, commentCommitId, codexAvailable, onClose } = props;
  const canComment = commentCommitId !== null;
  const [mode, setMode] = useState<Mode>(codexAvailable ? 'codex' : 'comment');
  const [text, setText] = useState('');
  const createThread = useCreateCodexThread(prNumber);
  const createComment = useCreateReviewComment(prNumber);
  const pending = createThread.isPending || createComment.isPending;
  const error = (createThread.error ?? createComment.error) as Error | null;
  const rangeLabel = fromLine === toLine ? `line ${toLine}` : `lines ${fromLine}–${toLine}`;

  const submit = async () => {
    if (!text.trim() || pending) return;
    if (mode === 'codex') {
      const { selectedText, hunk } = extractSelection(patch, side, fromLine, toLine);
      await createThread.mutateAsync({
        scope,
        selection: { path, side, startLine: fromLine, endLine: toLine, selectedText, hunk },
        question: text,
      });
    } else if (commentCommitId) {
      const ghSide = side === 'new' ? 'RIGHT' : 'LEFT';
      await createComment.mutateAsync({
        body: text,
        path,
        line: toLine,
        side: ghSide,
        startLine: fromLine !== toLine ? fromLine : undefined,
        startSide: fromLine !== toLine ? ghSide : undefined,
        commitId: commentCommitId,
      });
    }
    setText('');
    onClose();
  };

  return (
    <div className="line-widget">
      <div className="line-widget-header">
        {codexAvailable && canComment ? (
          <SegmentedControl aria-label="Action" size="small" onChange={(index) => setMode(index === 0 ? 'codex' : 'comment')}>
            <SegmentedControl.Button selected={mode === 'codex'} leadingIcon={CopilotIcon}>
              Ask codex
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === 'comment'} leadingIcon={CommentIcon}>
              Comment on GitHub
            </SegmentedControl.Button>
          </SegmentedControl>
        ) : (
          <strong>{mode === 'codex' ? 'Ask codex' : 'Comment on GitHub'}</strong>
        )}
        <span className="muted line-widget-range">
          {rangeLabel} · {side === 'new' ? 'new' : 'old'} side
        </span>
      </div>
      <Textarea
        block
        rows={3}
        autoFocus
        placeholder={mode === 'codex' ? 'What would you like to know about these lines?' : 'Leave a review comment…'}
        value={text}
        disabled={pending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
          if (event.key === 'Escape') onClose();
        }}
      />
      {error && <p className="form-error">{error.message}</p>}
      <div className="inline-form-buttons">
        <Button size="small" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button size="small" variant="primary" onClick={submit} disabled={pending || !text.trim()}>
          {pending ? 'Sending…' : mode === 'codex' ? 'Ask' : 'Add comment'}
        </Button>
      </div>
    </div>
  );
}
