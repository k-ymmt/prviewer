import { createContext, useContext, useMemo } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { BranchName, Flash, Spinner, UnderlineNav } from '@primer/react';
import { CommentDiscussionIcon, FileDiffIcon, GitCommitIcon } from '@primer/octicons-react';
import type { PRDetail, PRPersistedState, RepoInfo } from '../../shared/types';
import { useFiles, usePR, usePRState, useRepo } from '../api/hooks';
import { viewedOps } from '../../shared/viewed';
import { PRStateLabel, Time, UserAvatar } from '../components/common';

export interface PRContextValue {
  pr: PRDetail;
  state: PRPersistedState;
  repo: RepoInfo;
}

const PRContext = createContext<PRContextValue | null>(null);

export function usePRContext(): PRContextValue {
  const value = useContext(PRContext);
  if (!value) throw new Error('usePRContext must be used inside PRPage');
  return value;
}

export function PRPage() {
  const params = useParams();
  const number = Number.parseInt(params.number ?? '', 10);
  const location = useLocation();
  const repo = useRepo();
  const pr = usePR(number);
  const state = usePRState(number);
  const files = useFiles(number);

  const viewedFileCount = useMemo(() => {
    if (!files.data || !state.data) return null;
    return files.data.filter((f) => viewedOps.fileViewedStatus(state.data.viewed, f.path, f.sha).viewed).length;
  }, [files.data, state.data]);

  if (!Number.isFinite(number)) return <p className="page-message">Invalid pull request number.</p>;
  if (pr.isPending || state.isPending || repo.isPending) {
    return (
      <p className="page-message">
        <Spinner size="small" /> Loading pull request #{number}…
      </p>
    );
  }
  if (pr.isError) return <Flash variant="danger">{(pr.error as Error).message}</Flash>;
  if (state.isError) return <Flash variant="danger">{(state.error as Error).message}</Flash>;
  if (repo.isError) return <Flash variant="danger">{(repo.error as Error).message}</Flash>;

  const detail = pr.data;
  const base = `/pr/${number}`;
  const path = location.pathname;
  const current = path.startsWith(`${base}/commits`) ? 'commits' : path.startsWith(`${base}/files`) ? 'files' : 'conversation';

  return (
    <PRContext.Provider value={{ pr: detail, state: state.data, repo: repo.data }}>
      <div className="page pr-page">
        <header className="pr-header">
          <h1 className="pr-title">
            {detail.title} <span className="pr-number">#{detail.number}</span>
          </h1>
          <div className="pr-subtitle">
            <PRStateLabel state={detail.state} isDraft={detail.isDraft} />
            <span className="pr-subtitle-text">
              <UserAvatar user={detail.author} size={18} /> <strong>{detail.author.login}</strong> wants to merge{' '}
              {detail.commitCount} {detail.commitCount === 1 ? 'commit' : 'commits'} into{' '}
              <BranchName>{detail.baseRefName}</BranchName> from <BranchName>{detail.headRefName}</BranchName> · opened{' '}
              <Time value={detail.createdAt} /> ·{' '}
              <a href={detail.url} target="_blank" rel="noreferrer">
                open on GitHub
              </a>
            </span>
          </div>
        </header>
        <UnderlineNav aria-label="Pull request sections" className="pr-tabs">
          <UnderlineNav.Item
            as={Link}
            to={base}
            aria-current={current === 'conversation' ? 'page' : undefined}
            icon={CommentDiscussionIcon}
            counter={detail.timeline.length}
          >
            Conversation
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${base}/commits`}
            aria-current={current === 'commits' ? 'page' : undefined}
            icon={GitCommitIcon}
            counter={detail.commitCount}
          >
            Commits
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${base}/files`}
            aria-current={current === 'files' ? 'page' : undefined}
            icon={FileDiffIcon}
            counter={viewedFileCount === null ? detail.changedFiles : `${viewedFileCount} / ${detail.changedFiles}`}
          >
            Files changed
          </UnderlineNav.Item>
        </UnderlineNav>
        <Outlet />
      </div>
    </PRContext.Provider>
  );
}
