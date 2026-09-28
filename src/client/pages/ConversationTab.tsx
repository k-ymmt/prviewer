import { useState } from 'react';
import { Button, Label, Radio, RadioGroup, Textarea, Timeline } from '@primer/react';
import { CommentIcon } from '@primer/octicons-react';
import type { Review, ReviewComment, SubmitReviewRequest } from '../../shared/types';
import { useCreateIssueComment, useSubmitReview } from '../api/hooks';
import { HtmlBody } from '../components/MarkdownBody';
import { ReviewStateIcon, Time, UserAvatar, reviewStateText } from '../components/common';
import { usePRContext } from './PRPage';

function InlineReviewComments({ comments }: { comments: ReviewComment[] }) {
  const roots = comments.filter((c) => c.replyToId === null);
  if (roots.length === 0) return null;
  return (
    <div className="review-inline-comments">
      {roots.map((comment) => (
        <div key={comment.id} className="review-inline-comment">
          <div className="review-inline-path muted">
            {comment.path}
            {comment.line !== null && ` · L${comment.line}`}
            {comment.outdated && <Label variant="attention">Outdated</Label>}
          </div>
          {comment.diffHunk && <pre className="review-inline-hunk">{comment.diffHunk.split('\n').slice(-4).join('\n')}</pre>}
          <HtmlBody html={comment.bodyHTML} className="inline-comment-body" />
        </div>
      ))}
    </div>
  );
}

function ReviewItem({ review }: { review: Review }) {
  const hasBody = review.body.trim() !== '';
  return (
    <Timeline.Item>
      <Timeline.Badge className={`timeline-badge-${review.state.toLowerCase()}`}>
        <ReviewStateIcon state={review.state} />
      </Timeline.Badge>
      <Timeline.Body>
        <div className="timeline-review">
          <div className="timeline-review-heading">
            <UserAvatar user={review.author} size={20} /> <strong>{review.author?.login ?? 'ghost'}</strong>{' '}
            {reviewStateText(review.state)}{' '}
            <span className="muted">
              <Time value={review.submittedAt} />
            </span>
          </div>
          {hasBody && (
            <div className="comment-card">
              <HtmlBody html={review.bodyHTML} className="comment-card-body" />
            </div>
          )}
          <InlineReviewComments comments={review.comments} />
        </div>
      </Timeline.Body>
    </Timeline.Item>
  );
}

function CommentForm({ prNumber }: { prNumber: number }) {
  const [body, setBody] = useState('');
  const create = useCreateIssueComment(prNumber);
  const submit = async () => {
    if (!body.trim()) return;
    await create.mutateAsync(body);
    setBody('');
  };
  return (
    <div className="comment-card new-comment">
      <div className="comment-card-header">Add a comment</div>
      <div className="comment-card-body">
        <Textarea
          block
          rows={5}
          placeholder="Leave a comment"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={create.isPending}
        />
        {create.isError && <p className="form-error">{(create.error as Error).message}</p>}
        <div className="inline-form-buttons">
          <Button variant="primary" onClick={submit} disabled={create.isPending || !body.trim()}>
            {create.isPending ? 'Commenting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewForm({ prNumber }: { prNumber: number }) {
  const [event, setEvent] = useState<SubmitReviewRequest['event']>('COMMENT');
  const [body, setBody] = useState('');
  const submitReview = useSubmitReview(prNumber);
  const canSubmit = event === 'APPROVE' || body.trim() !== '';
  const submit = async () => {
    if (!canSubmit) return;
    await submitReview.mutateAsync({ event, body });
    setBody('');
  };
  return (
    <div className="comment-card new-review">
      <div className="comment-card-header">Submit a review</div>
      <div className="comment-card-body">
        <RadioGroup name="review-event" onChange={(value) => setEvent((value ?? 'COMMENT') as SubmitReviewRequest['event'])}>
          <RadioGroup.Label visuallyHidden>Review type</RadioGroup.Label>
          <div className="review-form-options">
            <label className="review-form-option">
              <Radio value="COMMENT" checked={event === 'COMMENT'} /> Comment
            </label>
            <label className="review-form-option">
              <Radio value="APPROVE" checked={event === 'APPROVE'} /> Approve
            </label>
            <label className="review-form-option">
              <Radio value="REQUEST_CHANGES" checked={event === 'REQUEST_CHANGES'} /> Request changes
            </label>
          </div>
        </RadioGroup>
        <Textarea
          block
          rows={4}
          placeholder={event === 'APPROVE' ? 'Optional review summary' : 'Review summary (required)'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={submitReview.isPending}
        />
        {submitReview.isError && <p className="form-error">{(submitReview.error as Error).message}</p>}
        {submitReview.isSuccess && <p className="form-success">Review submitted.</p>}
        <div className="inline-form-buttons">
          <Button
            variant={event === 'REQUEST_CHANGES' ? 'danger' : 'primary'}
            onClick={submit}
            disabled={submitReview.isPending || !canSubmit}
          >
            {submitReview.isPending ? 'Submitting…' : 'Submit review'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConversationTab() {
  const { pr } = usePRContext();
  return (
    <div className="conversation-tab">
      <div className="conversation-main">
        <div className="comment-card">
          <div className="comment-card-header">
            <UserAvatar user={pr.author} size={20} /> <strong>{pr.author.login}</strong>{' '}
            <span className="muted">
              opened this pull request <Time value={pr.createdAt} />
            </span>
          </div>
          <HtmlBody html={pr.bodyHTML} className="comment-card-body" />
        </div>

        {pr.timeline.length > 0 && (
          <Timeline className="conversation-timeline">
            {pr.timeline.map((entry) =>
              entry.kind === 'comment' ? (
                <Timeline.Item key={entry.id}>
                  <Timeline.Badge>
                    <CommentIcon />
                  </Timeline.Badge>
                  <Timeline.Body>
                    <div className="comment-card">
                      <div className="comment-card-header">
                        <UserAvatar user={entry.author} size={20} /> <strong>{entry.author?.login ?? 'ghost'}</strong>{' '}
                        <span className="muted">
                          commented <Time value={entry.createdAt} />
                        </span>
                      </div>
                      <HtmlBody html={entry.bodyHTML} className="comment-card-body" />
                    </div>
                  </Timeline.Body>
                </Timeline.Item>
              ) : (
                <ReviewItem key={entry.id} review={entry} />
              ),
            )}
          </Timeline>
        )}

        <CommentForm prNumber={pr.number} />
        <ReviewForm prNumber={pr.number} />
      </div>
      <aside className="conversation-side">
        <section>
          <h3>Reviewers</h3>
          {pr.reviewRequests.length === 0 && pr.latestReviews.length === 0 && <p className="muted">No reviews yet</p>}
          <ul className="side-list">
            {pr.reviewRequests.map((r) => (
              <li key={`req-${r.login}`}>
                <UserAvatar user={r} size={18} /> {r.login} <span className="muted">· requested</span>
              </li>
            ))}
            {pr.latestReviews.map((r) => (
              <li key={`rev-${r.author?.login ?? 'ghost'}`}>
                <UserAvatar user={r.author} size={18} /> {r.author?.login ?? 'ghost'} <ReviewStateIcon state={r.state} />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Assignees</h3>
          {pr.assignees.length === 0 ? (
            <p className="muted">No one assigned</p>
          ) : (
            <ul className="side-list">
              {pr.assignees.map((a) => (
                <li key={a.login}>
                  <UserAvatar user={a} size={18} /> {a.login}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>Labels</h3>
          {pr.labels.length === 0 ? (
            <p className="muted">None yet</p>
          ) : (
            <div className="side-labels">
              {pr.labels.map((label) => (
                <Label key={label.name} style={{ borderColor: `#${label.color}` }}>
                  {label.name}
                </Label>
              ))}
            </div>
          )}
        </section>
        <section>
          <h3>Changes</h3>
          <p className="muted">
            {pr.changedFiles} files · <span className="diffstat-add">+{pr.additions}</span>{' '}
            <span className="diffstat-del">−{pr.deletions}</span>
          </p>
          <p className="muted">
            head <code>{pr.headRefOid.slice(0, 7)}</code>
          </p>
        </section>
      </aside>
    </div>
  );
}
