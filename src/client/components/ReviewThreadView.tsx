import { useState } from 'react';
import { Button, Label, Textarea } from '@primer/react';
import type { ReviewThread } from '../../shared/types';
import { useReplyReviewComment } from '../api/hooks';
import { HtmlBody } from './MarkdownBody';
import { Time, UserAvatar } from './common';

export function ReviewThreadView({ thread, prNumber }: { thread: ReviewThread; prNumber: number }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [body, setBody] = useState('');
  const reply = useReplyReviewComment(prNumber);
  const root = thread.comments[0];

  const submit = async () => {
    if (!root || !body.trim()) return;
    await reply.mutateAsync({ inReplyTo: root.databaseId, body });
    setBody('');
    setReplyOpen(false);
  };

  return (
    <div className={`inline-thread review-thread${thread.isResolved ? ' is-resolved' : ''}`}>
      <div className="inline-thread-header">
        <span className="inline-thread-title">GitHub review thread</span>
        {thread.isResolved && <Label variant="success">Resolved</Label>}
        {thread.isOutdated && <Label variant="attention">Outdated</Label>}
      </div>
      {thread.comments.map((comment) => (
        <div key={comment.id} className="inline-comment">
          <div className="inline-comment-meta">
            <UserAvatar user={comment.author} size={20} />
            <strong>{comment.author?.login ?? 'ghost'}</strong>
            <span className="muted">
              <Time value={comment.createdAt} />
            </span>
            <a className="muted inline-comment-link" href={comment.url} target="_blank" rel="noreferrer">
              open on GitHub
            </a>
          </div>
          <HtmlBody html={comment.bodyHTML} className="inline-comment-body" />
        </div>
      ))}
      <div className="inline-thread-actions">
        {replyOpen ? (
          <div className="inline-form">
            <Textarea
              block
              rows={3}
              placeholder="Reply…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={reply.isPending}
            />
            {reply.isError && <p className="form-error">{(reply.error as Error).message}</p>}
            <div className="inline-form-buttons">
              <Button size="small" onClick={() => setReplyOpen(false)} disabled={reply.isPending}>
                Cancel
              </Button>
              <Button size="small" variant="primary" onClick={submit} disabled={reply.isPending || !body.trim()}>
                {reply.isPending ? 'Replying…' : 'Reply'}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="small" onClick={() => setReplyOpen(true)}>
            Reply
          </Button>
        )}
      </div>
    </div>
  );
}
