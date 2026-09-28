// Shared API types between the server and the client.

export interface RepoInfo {
  owner: string;
  name: string;
  nameWithOwner: string;
  url: string;
  viewerLogin: string;
  repoRoot: string;
  codexAvailable: boolean;
}

export interface UserRef {
  login: string;
  avatarUrl: string;
}

export interface LabelRef {
  name: string;
  color: string;
}

export type PRState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface PRSummary {
  number: number;
  title: string;
  state: PRState;
  isDraft: boolean;
  author: UserRef;
  url: string;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  labels: LabelRef[];
  reviewDecision: string | null;
  reviewRequests: UserRef[];
  commentsCount: number;
}

export interface PRListResponse {
  query: string;
  items: PRSummary[];
}

export interface IssueComment {
  kind: 'comment';
  id: string;
  databaseId: number;
  author: UserRef | null;
  bodyHTML: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface ReviewComment {
  id: string;
  databaseId: number;
  author: UserRef | null;
  bodyHTML: string;
  body: string;
  createdAt: string;
  url: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  diffHunk: string;
  outdated: boolean;
  replyToId: string | null;
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface Review {
  kind: 'review';
  id: string;
  databaseId: number;
  author: UserRef | null;
  state: ReviewState;
  bodyHTML: string;
  body: string;
  submittedAt: string | null;
  url: string;
  comments: ReviewComment[];
}

export type TimelineEntry = IssueComment | Review;

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  startDiffSide: 'LEFT' | 'RIGHT' | null;
  comments: ReviewComment[];
}

export interface PRDetail {
  id: string;
  number: number;
  title: string;
  body: string;
  bodyHTML: string;
  state: PRState;
  isDraft: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: UserRef;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  mergeable: string;
  labels: LabelRef[];
  assignees: UserRef[];
  reviewRequests: UserRef[];
  latestReviews: { author: UserRef | null; state: ReviewState; submittedAt: string | null }[];
  timeline: TimelineEntry[];
  reviewThreads: ReviewThread[];
  commitCount: number;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  subject: string;
  author: { name: string; login: string | null; avatarUrl: string | null; date: string };
  url: string;
  parents: string[];
}

export type FileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  changes: number;
  /** Blob SHA of the file at the relevant revision. */
  sha: string;
  /** Unified diff hunks. Null when GitHub does not provide a patch (binary / too large). */
  patch: string | null;
}

export interface CommitComment {
  id: number;
  author: UserRef | null;
  bodyHTML: string;
  body: string;
  createdAt: string;
  path: string | null;
  line: number | null;
  url: string;
}

export interface CommitDetail extends CommitSummary {
  files: ChangedFile[];
  comments: CommitComment[];
  stats: { additions: number; deletions: number; total: number };
}

// ---- Persisted per-PR state ----

export interface ViewedFileEntry {
  blobSha: string;
  viewedAt: string;
}

export interface ViewedState {
  /** Commit SHA -> viewed. */
  commits: Record<string, true>;
  /** "<sha>:<path>" -> viewed. */
  commitFiles: Record<string, true>;
  /** File path -> viewed entry. */
  files: Record<string, ViewedFileEntry>;
}

export type CodexScope = { kind: 'pr' } | { kind: 'commit'; sha: string };

export type DiffSide = 'old' | 'new';

export interface CodexSelection {
  path: string;
  side: DiffSide;
  startLine: number;
  endLine: number;
  /** The selected source lines, without diff markers. */
  selectedText: string;
  /** The unified diff hunk(s) around the selection. */
  hunk: string;
}

export type CodexMessageStatus = 'streaming' | 'done' | 'error';

export interface CodexMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  status: CodexMessageStatus;
  error?: string;
}

export interface CodexThread {
  id: string;
  codexThreadId: string | null;
  scope: CodexScope;
  selection: CodexSelection;
  createdAt: string;
  updatedAt: string;
  messages: CodexMessage[];
}

export interface PRPersistedState {
  version: 1;
  viewed: ViewedState;
  codexThreads: CodexThread[];
}

// ---- Request bodies ----

export interface SetCommitViewedRequest {
  sha: string;
  viewed: boolean;
}

export interface SetCommitFileViewedRequest {
  sha: string;
  path: string;
  viewed: boolean;
}

export interface SetFileViewedRequest {
  path: string;
  blobSha: string;
  viewed: boolean;
}

export interface CreateCodexThreadRequest {
  scope: CodexScope;
  selection: CodexSelection;
  question: string;
}

export interface AskCodexRequest {
  question: string;
}

export interface AskResultDto {
  thread: CodexThread;
  messageId: string;
}

export type CodexStreamEvent =
  | { type: 'thread'; thread: CodexThread }
  | { type: 'delta'; messageId: string; delta: string }
  | { type: 'done'; message: CodexMessage }
  | { type: 'error'; messageId: string; error: string };

export interface CreateIssueCommentRequest {
  body: string;
}

export interface CreateReviewCommentRequest {
  body: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  commitId: string;
}

export interface ReplyReviewCommentRequest {
  body: string;
  inReplyTo: number;
}

export interface SubmitReviewRequest {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body: string;
}

export interface ApiError {
  error: string;
}
