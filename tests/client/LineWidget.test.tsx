import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineWidget } from '../../src/client/components/LineWidget';
import { PRESETS, presetLabel } from '../../src/client/pages/PRListPage';

const patch = '@@ -1,2 +1,3 @@\n line1\n+added\n line2';

function renderWidget(props: Partial<React.ComponentProps<typeof LineWidget>> = {}) {
  const client = new QueryClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <LineWidget
        prNumber={9}
        path="src/a.ts"
        patch={patch}
        side="new"
        fromLine={2}
        toLine={2}
        scope={{ kind: 'pr' }}
        commentCommitId="headsha"
        codexAvailable
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('LineWidget', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the selected lines and hunk to the codex endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ thread: { id: 't', messages: [] }, messageId: 'm' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { onClose } = renderWidget();
    fireEvent.change(screen.getByPlaceholderText(/What would you like to know/), { target: { value: 'Why?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/prs/9/codex/threads');
    const body = JSON.parse(init.body as string) as {
      question: string;
      selection: { selectedText: string; hunk: string; startLine: number };
    };
    expect(body.question).toBe('Why?');
    expect(body.selection.selectedText).toBe('added');
    expect(body.selection.startLine).toBe(2);
    expect(body.selection.hunk).toContain('@@ -1,2 +1,3 @@');
  });

  it('posts a GitHub review comment when the comment mode is selected', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    renderWidget({ codexAvailable: false, fromLine: 1, toLine: 3 });
    fireEvent.change(screen.getByPlaceholderText(/Leave a review comment/), { target: { value: 'LGTM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/prs/9/review-comments');
    expect(JSON.parse(init.body as string)).toEqual({
      body: 'LGTM',
      path: 'src/a.ts',
      line: 3,
      side: 'RIGHT',
      startLine: 1,
      startSide: 'RIGHT',
      commitId: 'headsha',
    });
  });
});

describe('PR list presets', () => {
  it('defaults to pull requests awaiting my review', () => {
    expect(PRESETS[0]?.query).toBe('is:open review-requested:@me');
    expect(presetLabel('is:open review-requested:@me')).toBe('Awaiting my review');
    expect(presetLabel('label:bug')).toBe('Custom filter');
  });
});
