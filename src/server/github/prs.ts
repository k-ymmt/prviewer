import { ghJson, type GhRunner } from '../gh.js';
import type {
  ChangedFile,
  CommitComment,
  CommitDetail,
  CommitSummary,
  CreateReviewCommentRequest,
  FileStatus,
  IssueComment,
  LabelRef,
  PRDetail,
  PRSummary,
  Review,
  ReviewComment,
  ReviewState,
  ReviewThread,
  SubmitReviewRequest,
  TimelineEntry,
  UserRef,
} from '../../shared/types.js';

export interface RepoRef {
  owner: string;
  name: string;
}

export const DEFAULT_PR_QUERY = 'is:open review-requested:@me';

// ---------- PR list ----------

interface GhPrListItem {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  author: { login: string; avatarUrl?: string } | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  labels: { name: string; color: string }[];
  reviewDecision: string;
  reviewRequests: { login?: string; name?: string; avatarUrl?: string }[];
  comments: unknown[];
}

export function buildPrListArgs(repo: RepoRef, query: string, limit: number): string[] {
  const search = query.trim();
  return [
    'pr',
    'list',
    '--repo',
    `${repo.owner}/${repo.name}`,
    '--state',
    'all',
    '--limit',
    String(limit),
    ...(search ? ['--search', search] : []),
    '--json',
    'number,title,state,isDraft,author,url,createdAt,updatedAt,headRefName,baseRefName,labels,reviewDecision,reviewRequests,comments',
  ];
}

export async function listPullRequests(gh: GhRunner, repo: RepoRef, query: string, limit = 50): Promise<PRSummary[]> {
  const items = await ghJson<GhPrListItem[]>(gh, buildPrListArgs(repo, query, limit));
  return (items ?? []).map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    isDraft: item.isDraft,
    author: toUser(item.author),
    url: item.url,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    headRefName: item.headRefName,
    baseRefName: item.baseRefName,
    labels: item.labels ?? [],
    reviewDecision: item.reviewDecision || null,
    reviewRequests: (item.reviewRequests ?? []).map((r) => ({
      login: r.login ?? r.name ?? 'unknown',
      avatarUrl: r.avatarUrl ?? '',
    })),
    commentsCount: item.comments?.length ?? 0,
  }));
}

function toUser(user: { login: string; avatarUrl?: string } | null | undefined): UserRef {
  if (!user) return { login: 'ghost', avatarUrl: '' };
  return { login: user.login, avatarUrl: user.avatarUrl ?? '' };
}

// ---------- PR detail (GraphQL) ----------

const PR_DETAIL_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      number
      title
      body
      bodyHTML
      state
      isDraft
      url
      createdAt
      updatedAt
      mergedAt
      closedAt
      author { login avatarUrl }
      baseRefName
      headRefName
      headRefOid
      additions
      deletions
      changedFiles
      reviewDecision
      mergeable
      labels(first: 30) { nodes { name color } }
      assignees(first: 20) { nodes { login avatarUrl } }
      reviewRequests(first: 30) {
        nodes {
          requestedReviewer {
            ... on User { login avatarUrl }
            ... on Team { name avatarUrl }
          }
        }
      }
      latestReviews(first: 30) { nodes { author { login avatarUrl } state submittedAt } }
      commits { totalCount }
      comments(first: 100) {
        nodes { id databaseId author { login avatarUrl } body bodyHTML createdAt url }
      }
      reviews(first: 100) {
        nodes {
          id databaseId author { login avatarUrl } state body bodyHTML submittedAt url
          comments(first: 100) {
            nodes {
              id databaseId author { login avatarUrl } body bodyHTML createdAt url
              path line startLine originalLine diffHunk outdated
              replyTo { id }
            }
          }
        }
      }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine diffSide startDiffSide
          comments(first: 100) {
            nodes {
              id databaseId author { login avatarUrl } body bodyHTML createdAt url
              path line startLine originalLine diffHunk outdated
              replyTo { id }
            }
          }
        }
      }
    }
  }
}`;

interface GqlUser {
  login: string;
  avatarUrl: string;
}

interface GqlReviewComment {
  id: string;
  databaseId: number;
  author: GqlUser | null;
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  diffHunk: string;
  outdated: boolean;
  replyTo: { id: string } | null;
}

interface GqlPullRequest {
  id: string;
  number: number;
  title: string;
  body: string;
  bodyHTML: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: GqlUser | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  mergeable: string;
  labels: { nodes: LabelRef[] };
  assignees: { nodes: GqlUser[] };
  reviewRequests: { nodes: { requestedReviewer: { login?: string; name?: string; avatarUrl: string } | null }[] };
  latestReviews: { nodes: { author: GqlUser | null; state: ReviewState; submittedAt: string | null }[] };
  commits: { totalCount: number };
  comments: {
    nodes: {
      id: string;
      databaseId: number;
      author: GqlUser | null;
      body: string;
      bodyHTML: string;
      createdAt: string;
      url: string;
    }[];
  };
  reviews: {
    nodes: {
      id: string;
      databaseId: number;
      author: GqlUser | null;
      state: ReviewState;
      body: string;
      bodyHTML: string;
      submittedAt: string | null;
      url: string;
      comments: { nodes: GqlReviewComment[] };
    }[];
  };
  reviewThreads: {
    nodes: {
      id: string;
      isResolved: boolean;
      isOutdated: boolean;
      path: string;
      line: number | null;
      startLine: number | null;
      diffSide: 'LEFT' | 'RIGHT';
      startDiffSide: 'LEFT' | 'RIGHT' | null;
      comments: { nodes: GqlReviewComment[] };
    }[];
  };
}

function toReviewComment(c: GqlReviewComment): ReviewComment {
  return {
    id: c.id,
    databaseId: c.databaseId,
    author: c.author ? toUser(c.author) : null,
    body: c.body,
    bodyHTML: c.bodyHTML,
    createdAt: c.createdAt,
    url: c.url,
    path: c.path,
    line: c.line,
    startLine: c.startLine,
    originalLine: c.originalLine,
    diffHunk: c.diffHunk,
    outdated: c.outdated,
    replyToId: c.replyTo?.id ?? null,
  };
}

export function mapPullRequestDetail(pr: GqlPullRequest): PRDetail {
  const comments: IssueComment[] = pr.comments.nodes.map((c) => ({
    kind: 'comment',
    id: c.id,
    databaseId: c.databaseId,
    author: c.author ? toUser(c.author) : null,
    body: c.body,
    bodyHTML: c.bodyHTML,
    createdAt: c.createdAt,
    url: c.url,
  }));
  const reviews: Review[] = pr.reviews.nodes
    .filter((r) => r.state !== 'PENDING')
    .map((r) => ({
      kind: 'review',
      id: r.id,
      databaseId: r.databaseId,
      author: r.author ? toUser(r.author) : null,
      state: r.state,
      body: r.body,
      bodyHTML: r.bodyHTML,
      submittedAt: r.submittedAt,
      url: r.url,
      comments: r.comments.nodes.map(toReviewComment),
    }));
  const timeline: TimelineEntry[] = [...comments, ...reviews].sort((a, b) => {
    const ta = a.kind === 'comment' ? a.createdAt : (a.submittedAt ?? '');
    const tb = b.kind === 'comment' ? b.createdAt : (b.submittedAt ?? '');
    return ta.localeCompare(tb);
  });
  const reviewThreads: ReviewThread[] = pr.reviewThreads.nodes.map((t) => ({
    id: t.id,
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    path: t.path,
    line: t.line,
    startLine: t.startLine,
    diffSide: t.diffSide,
    startDiffSide: t.startDiffSide,
    comments: t.comments.nodes.map(toReviewComment),
  }));
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    bodyHTML: pr.bodyHTML,
    state: pr.state,
    isDraft: pr.isDraft,
    url: pr.url,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    author: toUser(pr.author),
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    reviewDecision: pr.reviewDecision,
    mergeable: pr.mergeable,
    labels: pr.labels.nodes,
    assignees: pr.assignees.nodes.map(toUser),
    reviewRequests: pr.reviewRequests.nodes
      .filter((n) => n.requestedReviewer)
      .map((n) => ({
        login: n.requestedReviewer?.login ?? n.requestedReviewer?.name ?? 'unknown',
        avatarUrl: n.requestedReviewer?.avatarUrl ?? '',
      })),
    latestReviews: pr.latestReviews.nodes.map((r) => ({
      author: r.author ? toUser(r.author) : null,
      state: r.state,
      submittedAt: r.submittedAt,
    })),
    timeline,
    reviewThreads,
    commitCount: pr.commits.totalCount,
  };
}

export async function getPullRequest(gh: GhRunner, repo: RepoRef, number: number): Promise<PRDetail> {
  const result = await ghJson<{ data: { repository: { pullRequest: GqlPullRequest | null } } }>(gh, [
    'api',
    'graphql',
    '-f',
    `query=${PR_DETAIL_QUERY}`,
    '-F',
    `owner=${repo.owner}`,
    '-F',
    `name=${repo.name}`,
    '-F',
    `number=${number}`,
  ]);
  const pr = result?.data?.repository?.pullRequest;
  if (!pr) {
    throw new Error(`Pull request #${number} not found`);
  }
  return mapPullRequestDetail(pr);
}

// ---------- Commits ----------

interface GhCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
    committer: { name: string; date: string } | null;
  };
  author: { login: string; avatar_url: string } | null;
  parents: { sha: string }[];
  files?: GhFile[];
  stats?: { additions: number; deletions: number; total: number };
}

interface GhFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  sha: string;
  patch?: string;
}

function toCommitSummary(c: GhCommit): CommitSummary {
  const message = c.commit.message ?? '';
  const subject = message.split('\n')[0] ?? '';
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message,
    subject,
    author: {
      name: c.commit.author?.name ?? c.author?.login ?? 'unknown',
      login: c.author?.login ?? null,
      avatarUrl: c.author?.avatar_url ?? null,
      date: c.commit.author?.date ?? c.commit.committer?.date ?? '',
    },
    url: c.html_url,
    parents: (c.parents ?? []).map((p) => p.sha),
  };
}

function normalizeStatus(status: string): FileStatus {
  switch (status) {
    case 'added':
    case 'removed':
    case 'modified':
    case 'renamed':
    case 'copied':
    case 'changed':
    case 'unchanged':
      return status;
    default:
      return 'modified';
  }
}

export function toChangedFile(f: GhFile): ChangedFile {
  return {
    path: f.filename,
    previousPath: f.previous_filename ?? null,
    status: normalizeStatus(f.status),
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    sha: f.sha,
    patch: f.patch ?? null,
  };
}

async function paginate<T>(gh: GhRunner, path: string): Promise<T[]> {
  const pages = await ghJson<T[][]>(gh, ['api', '--paginate', '--slurp', path]);
  return (pages ?? []).flat();
}

export async function listCommits(gh: GhRunner, repo: RepoRef, number: number): Promise<CommitSummary[]> {
  const commits = await paginate<GhCommit>(gh, `repos/${repo.owner}/${repo.name}/pulls/${number}/commits?per_page=100`);
  return commits.map(toCommitSummary);
}

export async function listFiles(gh: GhRunner, repo: RepoRef, number: number): Promise<ChangedFile[]> {
  const files = await paginate<GhFile>(gh, `repos/${repo.owner}/${repo.name}/pulls/${number}/files?per_page=100`);
  return files.map(toChangedFile);
}

interface GhCommitComment {
  id: number;
  user: { login: string; avatar_url: string } | null;
  body: string;
  body_html?: string;
  created_at: string;
  path: string | null;
  line: number | null;
  html_url: string;
}

export async function getCommit(gh: GhRunner, repo: RepoRef, sha: string): Promise<CommitDetail> {
  const [commit, comments] = await Promise.all([
    ghJson<GhCommit>(gh, ['api', `repos/${repo.owner}/${repo.name}/commits/${sha}`]),
    ghJson<GhCommitComment[]>(gh, [
      'api',
      '-H',
      'Accept: application/vnd.github.full+json',
      `repos/${repo.owner}/${repo.name}/commits/${sha}/comments`,
    ]).catch(() => [] as GhCommitComment[]),
  ]);
  const summary = toCommitSummary(commit);
  const mappedComments: CommitComment[] = (comments ?? []).map((c) => ({
    id: c.id,
    author: c.user ? { login: c.user.login, avatarUrl: c.user.avatar_url } : null,
    body: c.body,
    bodyHTML: c.body_html ?? '',
    createdAt: c.created_at,
    path: c.path,
    line: c.line,
    url: c.html_url,
  }));
  return {
    ...summary,
    files: (commit.files ?? []).map(toChangedFile),
    comments: mappedComments,
    stats: commit.stats ?? { additions: 0, deletions: 0, total: 0 },
  };
}

// ---------- Write operations ----------

export async function createIssueComment(gh: GhRunner, repo: RepoRef, number: number, body: string): Promise<void> {
  await gh(['api', '-X', 'POST', `repos/${repo.owner}/${repo.name}/issues/${number}/comments`, '--input', '-'], {
    input: JSON.stringify({ body }),
  });
}

export async function createReviewComment(
  gh: GhRunner,
  repo: RepoRef,
  number: number,
  req: CreateReviewCommentRequest,
): Promise<void> {
  const payload: Record<string, unknown> = {
    body: req.body,
    commit_id: req.commitId,
    path: req.path,
    line: req.line,
    side: req.side,
  };
  if (req.startLine !== undefined && req.startLine !== req.line) {
    payload.start_line = req.startLine;
    payload.start_side = req.startSide ?? req.side;
  }
  await gh(['api', '-X', 'POST', `repos/${repo.owner}/${repo.name}/pulls/${number}/comments`, '--input', '-'], {
    input: JSON.stringify(payload),
  });
}

export async function replyToReviewComment(
  gh: GhRunner,
  repo: RepoRef,
  number: number,
  inReplyTo: number,
  body: string,
): Promise<void> {
  await gh(
    ['api', '-X', 'POST', `repos/${repo.owner}/${repo.name}/pulls/${number}/comments/${inReplyTo}/replies`, '--input', '-'],
    { input: JSON.stringify({ body }) },
  );
}

export async function submitReview(gh: GhRunner, repo: RepoRef, number: number, req: SubmitReviewRequest): Promise<void> {
  await gh(['api', '-X', 'POST', `repos/${repo.owner}/${repo.name}/pulls/${number}/reviews`, '--input', '-'], {
    input: JSON.stringify({ event: req.event, body: req.body }),
  });
}
