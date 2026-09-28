import { useState } from 'react';
import { Button, IconButton, Spinner, Textarea } from '@primer/react';
import { CopilotIcon, TrashIcon } from '@primer/octicons-react';
import type { CodexMessage, CodexThread } from '../../shared/types';
import { useAskCodex, useCodexStream, useDeleteCodexThread } from '../api/hooks';
import { MarkdownText } from './MarkdownBody';
import { Time } from './common';

function AssistantMessage({ message, prNumber }: { message: CodexMessage; prNumber: number }) {
  useCodexStream(prNumber, message.id, message.status === 'streaming');
  return (
    <div className="codex-message codex-assistant">
      <div className="inline-comment-meta">
        <CopilotIcon />
        <strong>codex</strong>
        <span className="muted">
          <Time value={message.createdAt} />
        </span>
        {message.status === 'streaming' && (
          <span className="muted codex-streaming">
            <Spinner size="small" /> thinking…
          </span>
        )}
      </div>
      {message.text ? <MarkdownText markdown={message.text} className="inline-comment-body" /> : null}
      {message.status === 'error' && <p className="form-error">{message.error ?? 'codex failed to answer'}</p>}
    </div>
  );
}

export function CodexThreadView({ thread, prNumber }: { thread: CodexThread; prNumber: number }) {
  const [question, setQuestion] = useState('');
  const ask = useAskCodex(prNumber);
  const remove = useDeleteCodexThread(prNumber);
  const busy = thread.messages.some((m) => m.status === 'streaming') || ask.isPending;
  const { selection } = thread;
  const rangeLabel =
    selection.startLine === selection.endLine ? `L${selection.startLine}` : `L${selection.startLine}–L${selection.endLine}`;

  const submit = async () => {
    if (!question.trim() || busy) return;
    await ask.mutateAsync({ threadId: thread.id, question });
    setQuestion('');
  };

  return (
    <div className="inline-thread codex-thread">
      <div className="inline-thread-header">
        <CopilotIcon />
        <span className="inline-thread-title">
          Codex · {rangeLabel} ({selection.side === 'new' ? 'new' : 'old'} side)
        </span>
        <span className="flex-spacer" />
        <IconButton
          icon={TrashIcon}
          aria-label="Delete this codex thread"
          size="small"
          variant="invisible"
          disabled={busy || remove.isPending}
          onClick={() => {
            if (window.confirm('Delete this codex conversation?')) remove.mutate(thread.id);
          }}
        />
      </div>
      {thread.messages.map((message) =>
        message.role === 'user' ? (
          <div key={message.id} className="codex-message codex-user">
            <div className="inline-comment-meta">
              <strong>you</strong>
              <span className="muted">
                <Time value={message.createdAt} />
              </span>
            </div>
            <p className="codex-question">{message.text}</p>
          </div>
        ) : (
          <AssistantMessage key={message.id} message={message} prNumber={prNumber} />
        ),
      )}
      <div className="inline-form">
        <Textarea
          block
          rows={2}
          placeholder="Ask a follow-up question…"
          value={question}
          disabled={busy}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
          }}
        />
        {ask.isError && <p className="form-error">{(ask.error as Error).message}</p>}
        <div className="inline-form-buttons">
          <Button size="small" variant="primary" onClick={submit} disabled={busy || !question.trim()}>
            Ask codex
          </Button>
        </div>
      </div>
    </div>
  );
}
