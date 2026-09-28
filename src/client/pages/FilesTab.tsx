import { useMemo } from 'react';
import { Flash, ProgressBar, SegmentedControl, Spinner } from '@primer/react';
import { CheckCircleFillIcon, FileIcon } from '@primer/octicons-react';
import type { ChangedFile, CodexScope } from '../../shared/types';
import { viewedOps } from '../../shared/viewed';
import { useFiles, useSetFileViewed } from '../api/hooks';
import { FileDiff, type DiffMode } from '../components/FileDiff';
import { DiffStat } from '../components/common';
import { useLocalStorage } from '../lib/hooks';
import { usePRContext } from './PRPage';

const PR_SCOPE: CodexScope = { kind: 'pr' };

function FileNav({ files, viewedPaths }: { files: ChangedFile[]; viewedPaths: Set<string> }) {
  return (
    <nav className="file-nav" aria-label="Changed files">
      <ul>
        {files.map((file, index) => {
          const slash = file.path.lastIndexOf('/');
          const dir = slash >= 0 ? file.path.slice(0, slash + 1) : '';
          const base = slash >= 0 ? file.path.slice(slash + 1) : file.path;
          const viewed = viewedPaths.has(file.path);
          return (
            <li key={file.path} className={`file-nav-item status-${file.status}${viewed ? ' is-viewed' : ''}`}>
              <a
                href={`#file-${index}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(`file-${index}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }}
              >
                {viewed ? <CheckCircleFillIcon className="file-nav-viewed" /> : <FileIcon />}
                <span className="file-nav-path">
                  <span className="muted">{dir}</span>
                  {base}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function FilesTab() {
  const { pr, state, repo } = usePRContext();
  const files = useFiles(pr.number);
  const setFileViewed = useSetFileViewed(pr.number);
  const [mode, setMode] = useLocalStorage<DiffMode>('prviewer.diffMode', 'unified');

  const statuses = useMemo(() => {
    const map = new Map<string, { viewed: boolean; changedSinceViewed: boolean }>();
    for (const file of files.data ?? []) map.set(file.path, viewedOps.fileViewedStatus(state.viewed, file.path, file.sha));
    return map;
  }, [files.data, state.viewed]);
  const viewedPaths = useMemo(() => new Set([...statuses].filter(([, s]) => s.viewed).map(([p]) => p)), [statuses]);
  const threadsByPath = useMemo(() => {
    const map = new Map<string, typeof pr.reviewThreads>();
    for (const thread of pr.reviewThreads) {
      const list = map.get(thread.path) ?? [];
      list.push(thread);
      map.set(thread.path, list);
    }
    return map;
  }, [pr.reviewThreads]);
  const codexByPath = useMemo(() => {
    const map = new Map<string, typeof state.codexThreads>();
    for (const thread of state.codexThreads) {
      if (thread.scope.kind !== 'pr') continue;
      const list = map.get(thread.selection.path) ?? [];
      list.push(thread);
      map.set(thread.selection.path, list);
    }
    return map;
  }, [state.codexThreads]);

  if (files.isPending) {
    return (
      <p className="page-message">
        <Spinner size="small" /> Loading changed files…
      </p>
    );
  }
  if (files.isError) return <Flash variant="danger">{(files.error as Error).message}</Flash>;

  const total = files.data.length;
  const viewedCount = viewedPaths.size;
  const additions = files.data.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.data.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="files-tab">
      <div className="files-toolbar">
        <strong>
          {total} {total === 1 ? 'file' : 'files'} changed
        </strong>
        <DiffStat additions={additions} deletions={deletions} />
        <span className="flex-spacer" />
        <span className="files-progress">
          <span className="muted">
            {viewedCount} / {total} viewed
          </span>
          <ProgressBar
            progress={total === 0 ? 0 : (viewedCount / total) * 100}
            aria-label="Viewed files"
            barSize="small"
            inline
            style={{ width: 120 }}
          />
        </span>
        <SegmentedControl aria-label="Diff layout" size="small" onChange={(index) => setMode(index === 0 ? 'unified' : 'split')}>
          <SegmentedControl.Button selected={mode === 'unified'}>Unified</SegmentedControl.Button>
          <SegmentedControl.Button selected={mode === 'split'}>Split</SegmentedControl.Button>
        </SegmentedControl>
      </div>
      <div className="files-layout">
        <FileNav files={files.data} viewedPaths={viewedPaths} />
        <div className="file-diff-list">
          {files.data.map((file, index) => {
            const status = statuses.get(file.path) ?? { viewed: false, changedSinceViewed: false };
            return (
              <FileDiff
                key={file.path}
                anchorId={`file-${index}`}
                prNumber={pr.number}
                file={file}
                scope={PR_SCOPE}
                viewed={status.viewed}
                changedSinceViewed={status.changedSinceViewed}
                onToggleViewed={(viewed) => setFileViewed.mutate({ path: file.path, blobSha: file.sha, viewed })}
                reviewThreads={threadsByPath.get(file.path) ?? []}
                codexThreads={codexByPath.get(file.path) ?? []}
                mode={mode}
                commentCommitId={pr.headRefOid}
                codexAvailable={repo.codexAvailable}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
