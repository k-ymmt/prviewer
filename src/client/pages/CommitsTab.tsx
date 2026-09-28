import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Checkbox, Flash, SegmentedControl, Spinner } from '@primer/react';
import type { CodexScope, CommitDetail, CommitSummary } from '../../shared/types';
import { viewedOps } from '../../shared/viewed';
import { useCommit, useCommits, useSetCommitFileViewed, useSetCommitViewed } from '../api/hooks';
import { FileDiff, type DiffMode } from '../components/FileDiff';
import { HtmlBody } from '../components/MarkdownBody';
import { DiffStat, Time, UserAvatar } from '../components/common';
import { useLocalStorage } from '../lib/hooks';
import { usePRContext } from './PRPage';

function CommitRow({
  commit,
  selected,
  viewed,
  fileProgress,
  onToggle,
  prNumber,
}: {
  commit: CommitSummary;
  selected: boolean;
  viewed: boolean;
  fileProgress: string | null;
  onToggle: (viewed: boolean) => void;
  prNumber: number;
}) {
  return (
    <li className={`commit-row${selected ? ' is-selected' : ''}${viewed ? ' is-viewed' : ''}`}>
      <label className="commit-row-check" title="Mark commit as viewed">
        <Checkbox
          checked={viewed}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`Mark ${commit.shortSha} as viewed`}
        />
      </label>
      <Link to={`/pr/${prNumber}/commits/${commit.sha}`} className="commit-row-main">
        <span className="commit-row-subject">{commit.subject}</span>
        <span className="commit-row-meta muted">
          {commit.author.avatarUrl ? (
            <UserAvatar
              user={{ login: commit.author.login ?? commit.author.name, avatarUrl: commit.author.avatarUrl }}
              size={16}
            />
          ) : null}{' '}
          {commit.author.login ?? commit.author.name} · <code>{commit.shortSha}</code> · <Time value={commit.author.date} />
          {fileProgress && <span className="commit-row-progress"> · {fileProgress}</span>}
        </span>
      </Link>
    </li>
  );
}

function CommitDetailView({ commit, mode }: { commit: CommitDetail; mode: DiffMode }) {
  const { pr, state, repo } = usePRContext();
  const setFileViewed = useSetCommitFileViewed(pr.number);
  const scope = useMemo<CodexScope>(() => ({ kind: 'commit', sha: commit.sha }), [commit.sha]);
  const allPaths = useMemo(() => commit.files.map((f) => f.path), [commit.files]);
  const body = commit.message.split('\n').slice(1).join('\n').trim();
  const viewedCount = commit.files.filter((f) => viewedOps.isCommitFileViewed(state.viewed, commit.sha, f.path)).length;

  return (
    <div className="commit-detail">
      <div className="commit-detail-header">
        <h2 className="commit-detail-subject">{commit.subject}</h2>
        {body && <pre className="commit-detail-body">{body}</pre>}
        <div className="commit-detail-meta muted">
          {commit.author.avatarUrl ? (
            <UserAvatar
              user={{ login: commit.author.login ?? commit.author.name, avatarUrl: commit.author.avatarUrl }}
              size={18}
            />
          ) : null}{' '}
          <strong>{commit.author.login ?? commit.author.name}</strong> committed <Time value={commit.author.date} /> ·{' '}
          <a href={commit.url} target="_blank" rel="noreferrer">
            <code>{commit.sha.slice(0, 12)}</code>
          </a>{' '}
          · {commit.files.length} {commit.files.length === 1 ? 'file' : 'files'}{' '}
          <DiffStat additions={commit.stats.additions} deletions={commit.stats.deletions} /> · {viewedCount} /{' '}
          {commit.files.length} viewed
        </div>
      </div>

      {commit.comments.length > 0 && (
        <section className="commit-comments">
          <h3>Commit comments</h3>
          {commit.comments.map((comment) => (
            <div key={comment.id} className="comment-card">
              <div className="comment-card-header">
                <UserAvatar user={comment.author} size={20} /> <strong>{comment.author?.login ?? 'ghost'}</strong>{' '}
                <span className="muted">
                  commented <Time value={comment.createdAt} />
                  {comment.path && ` on ${comment.path}`}
                </span>
              </div>
              {comment.bodyHTML ? (
                <HtmlBody html={comment.bodyHTML} className="comment-card-body" />
              ) : (
                <pre className="comment-card-body">{comment.body}</pre>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="file-diff-list">
        {commit.files.map((file, index) => (
          <FileDiff
            key={`${commit.sha}:${file.path}`}
            anchorId={`commit-file-${index}`}
            prNumber={pr.number}
            file={file}
            scope={scope}
            viewed={viewedOps.isCommitFileViewed(state.viewed, commit.sha, file.path)}
            onToggleViewed={(viewed) => setFileViewed.mutate({ sha: commit.sha, path: file.path, viewed, allPaths })}
            codexThreads={state.codexThreads.filter(
              (t) => t.scope.kind === 'commit' && t.scope.sha === commit.sha && t.selection.path === file.path,
            )}
            mode={mode}
            commentCommitId={null}
            codexAvailable={repo.codexAvailable}
          />
        ))}
      </div>
    </div>
  );
}

export function CommitsTab() {
  const { pr, state } = usePRContext();
  const params = useParams();
  const navigate = useNavigate();
  const commits = useCommits(pr.number);
  const [mode, setMode] = useLocalStorage<DiffMode>('prviewer.diffMode', 'unified');
  const selectedSha = params.sha ?? null;
  const setCommitViewed = useSetCommitViewed(pr.number);

  useEffect(() => {
    if (!selectedSha && commits.data && commits.data.length > 0) {
      navigate(`/pr/${pr.number}/commits/${commits.data[0]?.sha}`, { replace: true });
    }
  }, [commits.data, navigate, pr.number, selectedSha]);

  const detail = useCommit(pr.number, selectedSha);

  if (commits.isPending) {
    return (
      <p className="page-message">
        <Spinner size="small" /> Loading commits…
      </p>
    );
  }
  if (commits.isError) return <Flash variant="danger">{(commits.error as Error).message}</Flash>;

  const viewedCommits = commits.data.filter((c) => state.viewed.commits[c.sha]).length;

  return (
    <div className="commits-tab">
      <aside className="commits-pane">
        <div className="commits-pane-header">
          <strong>
            {commits.data.length} {commits.data.length === 1 ? 'commit' : 'commits'}
          </strong>
          <span className="muted">
            {viewedCommits} / {commits.data.length} viewed
          </span>
        </div>
        <ul className="commit-list">
          {commits.data.map((commit) => {
            const isSelected = commit.sha === selectedSha;
            const cached = isSelected ? detail.data : undefined;
            const progress = cached
              ? `${cached.files.filter((f) => viewedOps.isCommitFileViewed(state.viewed, commit.sha, f.path)).length}/${cached.files.length} files`
              : null;
            return (
              <CommitRow
                key={commit.sha}
                commit={commit}
                prNumber={pr.number}
                selected={isSelected}
                viewed={state.viewed.commits[commit.sha] === true}
                fileProgress={progress}
                onToggle={(viewed) => setCommitViewed.mutate({ sha: commit.sha, viewed })}
              />
            );
          })}
        </ul>
      </aside>
      <section className="commits-detail-pane">
        <div className="pane-toolbar">
          <SegmentedControl
            aria-label="Diff layout"
            size="small"
            onChange={(index) => setMode(index === 0 ? 'unified' : 'split')}
          >
            <SegmentedControl.Button selected={mode === 'unified'}>Unified</SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === 'split'}>Split</SegmentedControl.Button>
          </SegmentedControl>
        </div>
        {!selectedSha && <p className="page-message">Select a commit to see its changes.</p>}
        {selectedSha && detail.isPending && (
          <p className="page-message">
            <Spinner size="small" /> Loading commit {selectedSha.slice(0, 7)}…
          </p>
        )}
        {detail.isError && <Flash variant="danger">{(detail.error as Error).message}</Flash>}
        {detail.data && <CommitDetailView commit={detail.data} mode={mode} />}
      </section>
    </div>
  );
}
