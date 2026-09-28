import { Avatar, Label, RelativeTime, StateLabel, Text } from '@primer/react';
import {
  CheckIcon,
  CommentIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  XIcon,
} from '@primer/octicons-react';
import type { PRState, ReviewState, UserRef } from '../../shared/types';

export function UserAvatar({ user, size = 20 }: { user: UserRef | null; size?: number }) {
  const login = user?.login ?? 'ghost';
  const src = user?.avatarUrl || `https://github.com/${login}.png?size=${size * 2}`;
  return <Avatar src={src} alt={login} size={size} />;
}

export function PRStateIcon({ state, isDraft }: { state: PRState; isDraft: boolean }) {
  if (state === 'MERGED') return <GitMergeIcon className="pr-state-icon pr-state-merged" />;
  if (state === 'CLOSED') return <GitPullRequestClosedIcon className="pr-state-icon pr-state-closed" />;
  if (isDraft) return <GitPullRequestDraftIcon className="pr-state-icon pr-state-draft" />;
  return <GitPullRequestIcon className="pr-state-icon pr-state-open" />;
}

export function PRStateLabel({ state, isDraft }: { state: PRState; isDraft: boolean }) {
  const status = state === 'MERGED' ? 'pullMerged' : state === 'CLOSED' ? 'pullClosed' : isDraft ? 'draft' : 'pullOpened';
  return (
    <StateLabel status={status}>
      {state === 'OPEN' && isDraft ? 'Draft' : state === 'OPEN' ? 'Open' : state === 'MERGED' ? 'Merged' : 'Closed'}
    </StateLabel>
  );
}

export function ReviewStateIcon({ state }: { state: ReviewState }) {
  switch (state) {
    case 'APPROVED':
      return <CheckIcon className="review-state-icon review-approved" />;
    case 'CHANGES_REQUESTED':
      return <XIcon className="review-state-icon review-changes" />;
    case 'DISMISSED':
      return <EyeIcon className="review-state-icon review-muted" />;
    default:
      return <CommentIcon className="review-state-icon review-muted" />;
  }
}

export function reviewStateText(state: ReviewState): string {
  switch (state) {
    case 'APPROVED':
      return 'approved these changes';
    case 'CHANGES_REQUESTED':
      return 'requested changes';
    case 'DISMISSED':
      return 'left a review that was dismissed';
    default:
      return 'reviewed';
  }
}

export function ReviewDecisionLabel({ decision }: { decision: string | null }) {
  if (!decision) return null;
  if (decision === 'APPROVED') return <Label variant="success">Approved</Label>;
  if (decision === 'CHANGES_REQUESTED') return <Label variant="danger">Changes requested</Label>;
  if (decision === 'REVIEW_REQUIRED') return <Label variant="attention">Review required</Label>;
  return <Label>{decision}</Label>;
}

export function Time({ value }: { value: string | null }) {
  if (!value) return null;
  return <RelativeTime date={new Date(value)} />;
}

export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diffstat">
      <Text className="diffstat-add">+{additions}</Text> <Text className="diffstat-del">−{deletions}</Text>
    </span>
  );
}

export function ChangedFilesIcon() {
  return <FileDiffIcon />;
}
