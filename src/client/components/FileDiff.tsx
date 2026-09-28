import { memo, useCallback, useMemo, useState } from 'react';
import { Checkbox, IconButton, Label } from '@primer/react';
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react';
import { DiffModeEnum, DiffViewWithMultiSelect, SplitSide } from '@git-diff-view/react';
import type { ChangedFile, CodexScope, CodexThread, ReviewThread } from '../../shared/types';
import { languageForPath, toGitDiff } from '../lib/diff';
import { ErrorBoundary } from './ErrorBoundary';
import { useInView, usePrefersDark } from '../lib/hooks';
import { CodexThreadView } from './CodexThreadView';
import { LineWidget } from './LineWidget';
import { ReviewThreadView } from './ReviewThreadView';
import { DiffStat } from './common';

export type DiffMode = 'unified' | 'split';

export interface FileDiffProps {
  prNumber: number;
  file: ChangedFile;
  scope: CodexScope;
  viewed: boolean;
  changedSinceViewed?: boolean;
  onToggleViewed: (viewed: boolean) => void;
  reviewThreads?: ReviewThread[];
  codexThreads: CodexThread[];
  mode: DiffMode;
  /** Commit id for new GitHub review comments; null disables commenting. */
  commentCommitId: string | null;
  codexAvailable: boolean;
  anchorId: string;
}

interface LineData {
  reviewThreads: ReviewThread[];
  codexThreads: CodexThread[];
}

type ExtendData = { oldFile: Record<string, { data: LineData }>; newFile: Record<string, { data: LineData }> };

function buildExtendData(reviewThreads: ReviewThread[], codexThreads: CodexThread[]): ExtendData {
  const result: ExtendData = { oldFile: {}, newFile: {} };
  const bucket = (side: 'old' | 'new', line: number): LineData => {
    const store = side === 'old' ? result.oldFile : result.newFile;
    const key = String(line);
    let entry = store[key];
    if (!entry) {
      entry = { data: { reviewThreads: [], codexThreads: [] } };
      store[key] = entry;
    }
    return entry.data;
  };
  for (const thread of reviewThreads) {
    if (thread.line === null) continue;
    bucket(thread.diffSide === 'LEFT' ? 'old' : 'new', thread.line).reviewThreads.push(thread);
  }
  for (const thread of codexThreads) {
    bucket(thread.selection.side, thread.selection.endLine).codexThreads.push(thread);
  }
  return result;
}

function statusLabel(file: ChangedFile) {
  switch (file.status) {
    case 'added':
      return <Label variant="success">Added</Label>;
    case 'removed':
      return <Label variant="danger">Deleted</Label>;
    case 'renamed':
      return <Label variant="accent">Renamed</Label>;
    case 'copied':
      return <Label variant="accent">Copied</Label>;
    default:
      return null;
  }
}

export const FileDiff = memo(function FileDiff(props: FileDiffProps) {
  const {
    prNumber,
    file,
    scope,
    viewed,
    changedSinceViewed,
    onToggleViewed,
    reviewThreads = [],
    codexThreads,
    mode,
    commentCommitId,
    codexAvailable,
    anchorId,
  } = props;
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const collapsed = collapsedOverride ?? viewed;
  const dark = usePrefersDark();
  const [containerRef, inView] = useInView<HTMLDivElement>();

  const lang = useMemo(() => languageForPath(file.path), [file.path]);
  const extendData = useMemo(() => buildExtendData(reviewThreads, codexThreads), [reviewThreads, codexThreads]);
  const outdatedThreads = useMemo(() => reviewThreads.filter((t) => t.line === null), [reviewThreads]);
  const data = useMemo(
    () => ({
      oldFile: { fileName: file.previousPath ?? file.path, fileLang: lang },
      newFile: { fileName: file.path, fileLang: lang },
      hunks: file.patch
        ? [toGitDiff({ path: file.path, previousPath: file.previousPath, status: file.status, patch: file.patch })]
        : [],
    }),
    [file.patch, file.path, file.previousPath, file.status, lang],
  );

  const renderExtendLine = useCallback(
    ({ data: lineData }: { data: LineData | undefined }) => {
      // In split mode the library asks for both sides of a row even when only one side has data.
      if (!lineData || (lineData.reviewThreads.length === 0 && lineData.codexThreads.length === 0)) return null;
      return (
        <div className="line-extensions">
          {lineData.reviewThreads.map((thread) => (
            <ReviewThreadView key={thread.id} thread={thread} prNumber={prNumber} />
          ))}
          {lineData.codexThreads.map((thread) => (
            <CodexThreadView key={thread.id} thread={thread} prNumber={prNumber} />
          ))}
        </div>
      );
    },
    [prNumber],
  );

  const renderWidgetLine = useCallback(
    ({
      lineNumber,
      fromLineNumber,
      side,
      onClose,
    }: {
      lineNumber: number;
      fromLineNumber: number;
      side: SplitSide;
      onClose: () => void;
    }) => (
      <LineWidget
        prNumber={prNumber}
        path={file.path}
        patch={file.patch ?? ''}
        side={side === SplitSide.old ? 'old' : 'new'}
        fromLine={Math.min(fromLineNumber, lineNumber)}
        toLine={Math.max(fromLineNumber, lineNumber)}
        scope={scope}
        commentCommitId={commentCommitId}
        codexAvailable={codexAvailable}
        onClose={onClose}
      />
    ),
    [codexAvailable, commentCommitId, file.patch, file.path, prNumber, scope],
  );

  const toggleViewed = (next: boolean) => {
    onToggleViewed(next);
    setCollapsedOverride(null);
  };

  return (
    <div id={anchorId} ref={containerRef} className={`file-diff${viewed ? ' is-viewed' : ''}`}>
      <div className="file-diff-header">
        <IconButton
          icon={collapsed ? ChevronRightIcon : ChevronDownIcon}
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
          size="small"
          variant="invisible"
          onClick={() => setCollapsedOverride(!collapsed)}
        />
        <span className="file-diff-path">
          {file.previousPath && file.previousPath !== file.path ? (
            <>
              <span className="muted">{file.previousPath}</span> → {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        {statusLabel(file)}
        <DiffStat additions={file.additions} deletions={file.deletions} />
        {changedSinceViewed && <Label variant="attention">Changed since viewed</Label>}
        <span className="flex-spacer" />
        <label className="viewed-toggle">
          <Checkbox checked={viewed} onChange={(event) => toggleViewed(event.target.checked)} />
          Viewed
        </label>
      </div>
      {!collapsed && (
        <div className="file-diff-body">
          {file.patch === null ? (
            <p className="file-diff-empty">No diff available (binary file, or the diff is too large to display).</p>
          ) : !inView ? (
            <div className="file-diff-placeholder" style={{ minHeight: Math.min(600, 24 * file.changes + 40) }} />
          ) : (
            <ErrorBoundary label={`Diff for ${file.path}`}>
              <DiffViewWithMultiSelect<LineData>
                data={data}
                diffViewMode={mode === 'split' ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
                diffViewTheme={dark ? 'dark' : 'light'}
                diffViewHighlight
                diffViewWrap={false}
                diffViewFontSize={12}
                diffViewAddWidget
                extendData={extendData}
                renderExtendLine={renderExtendLine}
                renderWidgetLine={renderWidgetLine}
              />
            </ErrorBoundary>
          )}
          {outdatedThreads.length > 0 && (
            <details className="outdated-threads">
              <summary>{outdatedThreads.length} outdated conversation(s)</summary>
              {outdatedThreads.map((thread) => (
                <ReviewThreadView key={thread.id} thread={thread} prNumber={prNumber} />
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
});
