import type { CodexStreamEvent } from '../../shared/types';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore body parse errors
    }
    throw new ApiRequestError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Subscribes to the SSE stream of a codex message. Returns an unsubscribe function.
 * `onEnd` is called once the stream finishes or the connection is lost.
 */
export function subscribeCodexStream(
  prNumber: number,
  messageId: string,
  onEvent: (event: CodexStreamEvent) => void,
  onEnd: (reason: 'done' | 'connection-lost') => void,
): () => void {
  const source = new EventSource(`/api/prs/${prNumber}/codex/messages/${encodeURIComponent(messageId)}/stream`);
  let finished = false;
  source.onmessage = (message) => {
    const event = JSON.parse(message.data as string) as CodexStreamEvent;
    onEvent(event);
    if (event.type === 'done' || event.type === 'error') {
      finished = true;
      source.close();
      onEnd('done');
    }
  };
  source.onerror = () => {
    if (finished) return;
    finished = true;
    source.close();
    onEnd('connection-lost');
  };
  return () => {
    finished = true;
    source.close();
  };
}
