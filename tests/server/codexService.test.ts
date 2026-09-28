import { describe, expect, it } from 'vitest';
import type { CodexClient, TurnHandlers, TurnResult } from '../../src/server/codex/appServer';
import { buildInitialPrompt } from '../../src/server/codex/prompt';
import { CodexService } from '../../src/server/codex/service';
import { createMemoryStoreRegistry } from '../../src/server/store/prStore';
import type { CodexSelection, CodexStreamEvent } from '../../src/shared/types';

const selection: CodexSelection = {
  path: 'src/a.ts',
  side: 'new',
  startLine: 3,
  endLine: 4,
  selectedText: 'const a = 1;\nconst b = 2;',
  hunk: '@@ -1,3 +1,4 @@\n line\n+const a = 1;\n+const b = 2;',
};

const ctx = {
  repo: 'octo/repo',
  prNumber: 7,
  prTitle: 'Add things',
  headSha: 'abcdef1234567890',
  baseRefName: 'main',
  headRefName: 'feature',
};

class FakeClient implements CodexClient {
  started = 0;
  resumed: string[] = [];
  prompts: string[] = [];
  behavior: 'ok' | 'fail' | 'throw' = 'ok';
  resumeFails = false;

  async startThread(): Promise<string> {
    this.started += 1;
    return `codex-${this.started}`;
  }

  async resumeThread(threadId: string): Promise<void> {
    if (this.resumeFails) throw new Error('gone');
    this.resumed.push(threadId);
  }

  async runTurn(_threadId: string, prompt: string, handlers?: TurnHandlers): Promise<TurnResult> {
    this.prompts.push(prompt);
    if (this.behavior === 'throw') throw new Error('connection lost');
    if (this.behavior === 'fail') return { text: '', status: 'failed', error: 'model error' };
    handlers?.onDelta?.('Ans');
    handlers?.onDelta?.('wer');
    return { text: 'Answer', status: 'completed', error: null };
  }

  dispose(): void {}
}

async function collect(events: AsyncIterable<CodexStreamEvent> | null): Promise<CodexStreamEvent[]> {
  if (!events) return [];
  const out: CodexStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('buildInitialPrompt', () => {
  it('includes selection, hunk, revision hints and the question', () => {
    const prompt = buildInitialPrompt({ ...ctx, scope: { kind: 'commit', sha: '1234567890abcdef' }, selection }, 'Why?');
    expect(prompt).toContain('commit 1234567 of pull request #7');
    expect(prompt).toContain('lines 3-4 on the new (right) side');
    expect(prompt).toContain('const a = 1;');
    expect(prompt).toContain('git show 1234567890abcdef:src/a.ts');
    expect(prompt.trim().endsWith('Why?')).toBe(true);
  });
});

describe('CodexService', () => {
  it('creates a thread, streams the answer and persists the final message', async () => {
    const client = new FakeClient();
    const service = new CodexService(client, '/repo');
    const store = createMemoryStoreRegistry().forPR(7);
    const { thread, messageId } = await service.createThread(store, { scope: { kind: 'pr' }, selection, question: 'What?' }, ctx);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]?.status).toBe('streaming');

    const events = await collect(service.subscribe(messageId));
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe('done');
    const text = events
      .filter((e) => e.type === 'delta')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(text).toBe('Answer');

    const persisted = (await store.load()).codexThreads[0];
    expect(persisted?.codexThreadId).toBe('codex-1');
    expect(persisted?.messages[1]).toMatchObject({ role: 'assistant', text: 'Answer', status: 'done' });
    expect(client.prompts[0]).toContain('What?');
  });

  it('resumes the codex thread for follow-up questions and falls back to a new thread when resume fails', async () => {
    const client = new FakeClient();
    const service = new CodexService(client, '/repo');
    const store = createMemoryStoreRegistry().forPR(7);
    const created = await service.createThread(store, { scope: { kind: 'pr' }, selection, question: 'Q1' }, ctx);
    await collect(service.subscribe(created.messageId));

    const followUp = await service.ask(store, created.thread.id, 'Q2');
    await collect(service.subscribe(followUp.messageId));
    expect(client.resumed).toEqual(['codex-1']);
    expect(client.prompts[1]).toBe('Q2');
    expect((await store.load()).codexThreads[0]?.messages).toHaveLength(4);

    client.resumeFails = true;
    const third = await service.ask(store, created.thread.id, 'Q3');
    await collect(service.subscribe(third.messageId));
    expect(client.started).toBe(2);
    expect((await store.load()).codexThreads[0]?.codexThreadId).toBe('codex-2');
  });

  it('records errors when the turn fails or the client throws', async () => {
    const client = new FakeClient();
    client.behavior = 'fail';
    const service = new CodexService(client, '/repo');
    const store = createMemoryStoreRegistry().forPR(7);
    const created = await service.createThread(store, { scope: { kind: 'pr' }, selection, question: 'Q' }, ctx);
    const events = await collect(service.subscribe(created.messageId));
    expect(events[events.length - 1]).toMatchObject({ type: 'error', error: 'model error' });
    expect((await store.load()).codexThreads[0]?.messages[1]).toMatchObject({ status: 'error', error: 'model error' });

    client.behavior = 'throw';
    const second = await service.ask(store, created.thread.id, 'Q2');
    const events2 = await collect(service.subscribe(second.messageId));
    expect(events2[events2.length - 1]).toMatchObject({ type: 'error', error: 'connection lost' });
  });

  it('repairs messages left streaming by a previous process', async () => {
    const registry = createMemoryStoreRegistry();
    const store = registry.forPR(1);
    await store.update((s) => ({
      state: {
        ...s,
        codexThreads: [
          {
            id: 't1',
            codexThreadId: null,
            scope: { kind: 'pr' },
            selection,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ id: 'm1', role: 'assistant', text: 'partial', createdAt: '2026-01-01T00:00:00Z', status: 'streaming' }],
          },
        ],
      },
      result: null,
    }));
    const service = new CodexService(new FakeClient(), '/repo');
    const threads = await service.listThreads(store);
    expect(threads[0]?.messages[0]).toMatchObject({ status: 'error', text: 'partial' });
  });

  it('deletes threads', async () => {
    const service = new CodexService(new FakeClient(), '/repo');
    const store = createMemoryStoreRegistry().forPR(7);
    const created = await service.createThread(store, { scope: { kind: 'pr' }, selection, question: 'Q' }, ctx);
    await collect(service.subscribe(created.messageId));
    await service.deleteThread(store, created.thread.id);
    expect((await store.load()).codexThreads).toEqual([]);
  });
});
