import { randomUUID } from 'node:crypto';
import type { CodexMessage, CodexStreamEvent, CodexThread, CreateCodexThreadRequest } from '../../shared/types.js';
import type { PRStore } from '../store/prStore.js';
import type { CodexClient } from './appServer.js';
import { buildFollowUpPrompt, buildInitialPrompt, type PromptContext } from './prompt.js';

export type ThreadPromptContext = Omit<PromptContext, 'scope' | 'selection'>;

interface ActiveRun {
  messageId: string;
  buffer: string;
  done: boolean;
  final: CodexStreamEvent | null;
  listeners: Set<(event: CodexStreamEvent) => void>;
}

export interface AskResult {
  thread: CodexThread;
  messageId: string;
}

export class CodexService {
  private readonly runs = new Map<string, ActiveRun>();

  constructor(
    private readonly client: CodexClient,
    private readonly cwd: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Lists threads, repairing messages that were left streaming by a previous server process. */
  async listThreads(store: PRStore): Promise<CodexThread[]> {
    const state = await store.load();
    const stale = state.codexThreads.some((t) => t.messages.some((m) => m.status === 'streaming' && !this.runs.has(m.id)));
    if (!stale) return state.codexThreads;
    return store.update((s) => {
      const codexThreads = s.codexThreads.map((t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.status === 'streaming' && !this.runs.has(m.id)
            ? { ...m, status: 'error' as const, error: 'Interrupted: the prviewer server restarted while codex was answering.' }
            : m,
        ),
      }));
      return { state: { ...s, codexThreads }, result: codexThreads };
    });
  }

  async createThread(store: PRStore, req: CreateCodexThreadRequest, ctx: ThreadPromptContext): Promise<AskResult> {
    const timestamp = this.now().toISOString();
    const userMessage: CodexMessage = {
      id: randomUUID(),
      role: 'user',
      text: req.question,
      createdAt: timestamp,
      status: 'done',
    };
    const assistantMessage: CodexMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: timestamp,
      status: 'streaming',
    };
    const thread: CodexThread = {
      id: randomUUID(),
      codexThreadId: null,
      scope: req.scope,
      selection: req.selection,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [userMessage, assistantMessage],
    };
    await store.update((s) => ({ state: { ...s, codexThreads: [...s.codexThreads, thread] }, result: undefined }));
    const prompt = buildInitialPrompt({ ...ctx, scope: req.scope, selection: req.selection }, req.question);
    this.startRun(store, thread.id, assistantMessage.id, prompt);
    return { thread, messageId: assistantMessage.id };
  }

  async ask(store: PRStore, threadId: string, question: string): Promise<AskResult> {
    const timestamp = this.now().toISOString();
    const userMessage: CodexMessage = { id: randomUUID(), role: 'user', text: question, createdAt: timestamp, status: 'done' };
    const assistantMessage: CodexMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: timestamp,
      status: 'streaming',
    };
    const thread = await store.update((s) => {
      const existing = s.codexThreads.find((t) => t.id === threadId);
      if (!existing) throw new Error(`Codex thread ${threadId} not found`);
      if (existing.messages.some((m) => m.status === 'streaming' && this.runs.has(m.id))) {
        throw new Error('Codex is still answering the previous question in this thread');
      }
      const updated: CodexThread = {
        ...existing,
        updatedAt: timestamp,
        messages: [...existing.messages, userMessage, assistantMessage],
      };
      return {
        state: { ...s, codexThreads: s.codexThreads.map((t) => (t.id === threadId ? updated : t)) },
        result: updated,
      };
    });
    this.startRun(store, thread.id, assistantMessage.id, buildFollowUpPrompt(question));
    return { thread, messageId: assistantMessage.id };
  }

  async deleteThread(store: PRStore, threadId: string): Promise<void> {
    await store.update((s) => ({
      state: { ...s, codexThreads: s.codexThreads.filter((t) => t.id !== threadId) },
      result: undefined,
    }));
  }

  /** Subscribes to the events of a running (or just finished) assistant message. */
  subscribe(messageId: string): AsyncIterable<CodexStreamEvent> | null {
    const run = this.runs.get(messageId);
    if (!run) return null;
    return {
      [Symbol.asyncIterator]: () => {
        const queue: CodexStreamEvent[] = [];
        let notify: (() => void) | null = null;
        let finished = false;
        if (run.buffer) queue.push({ type: 'delta', messageId, delta: run.buffer });
        if (run.done && run.final) {
          queue.push(run.final);
          finished = true;
        }
        const listener = (event: CodexStreamEvent) => {
          queue.push(event);
          if (event.type === 'done' || event.type === 'error') finished = true;
          notify?.();
        };
        if (!finished) run.listeners.add(listener);
        return {
          async next(): Promise<IteratorResult<CodexStreamEvent>> {
            while (queue.length === 0) {
              if (finished) {
                run.listeners.delete(listener);
                return { value: undefined, done: true };
              }
              await new Promise<void>((resolve) => {
                notify = resolve;
              });
              notify = null;
            }
            return { value: queue.shift() as CodexStreamEvent, done: false };
          },
          async return(): Promise<IteratorResult<CodexStreamEvent>> {
            run.listeners.delete(listener);
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  private startRun(store: PRStore, threadId: string, messageId: string, prompt: string): void {
    const run: ActiveRun = { messageId, buffer: '', done: false, final: null, listeners: new Set() };
    this.runs.set(messageId, run);
    const emit = (event: CodexStreamEvent) => {
      for (const listener of run.listeners) listener(event);
    };
    void (async () => {
      let final: CodexStreamEvent;
      try {
        const codexThreadId = await this.ensureCodexThread(store, threadId);
        const result = await this.client.runTurn(codexThreadId, prompt, {
          onDelta: (delta) => {
            run.buffer += delta;
            emit({ type: 'delta', messageId, delta });
          },
        });
        const text = result.text || run.buffer;
        if (result.status === 'completed') {
          const message = await this.finishMessage(store, threadId, messageId, { text, status: 'done' });
          final = { type: 'done', message };
        } else {
          const error = result.error ?? 'codex turn did not complete';
          await this.finishMessage(store, threadId, messageId, { text, status: 'error', error });
          final = { type: 'error', messageId, error };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.finishMessage(store, threadId, messageId, { text: run.buffer, status: 'error', error: message }).catch(
          () => undefined,
        );
        final = { type: 'error', messageId, error: message };
      }
      run.done = true;
      run.final = final;
      emit(final);
      // Keep the finished run around briefly so late subscribers can still read the result.
      setTimeout(() => this.runs.delete(messageId), 30_000).unref?.();
    })();
  }

  private async ensureCodexThread(store: PRStore, threadId: string): Promise<string> {
    const state = await store.load();
    const thread = state.codexThreads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`Codex thread ${threadId} not found`);
    if (thread.codexThreadId) {
      try {
        await this.client.resumeThread(thread.codexThreadId, this.cwd);
        return thread.codexThreadId;
      } catch {
        // The codex-side thread is gone (e.g. deleted); fall through and create a fresh one.
      }
    }
    const codexThreadId = await this.client.startThread(this.cwd);
    await store.update((s) => ({
      state: {
        ...s,
        codexThreads: s.codexThreads.map((t) => (t.id === threadId ? { ...t, codexThreadId } : t)),
      },
      result: undefined,
    }));
    return codexThreadId;
  }

  private finishMessage(
    store: PRStore,
    threadId: string,
    messageId: string,
    patch: { text: string; status: 'done' | 'error'; error?: string },
  ): Promise<CodexMessage> {
    return store.update((s) => {
      let updatedMessage: CodexMessage | null = null;
      const codexThreads = s.codexThreads.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          updatedAt: this.now().toISOString(),
          messages: t.messages.map((m) => {
            if (m.id !== messageId) return m;
            updatedMessage = { ...m, text: patch.text, status: patch.status, ...(patch.error ? { error: patch.error } : {}) };
            return updatedMessage;
          }),
        };
      });
      if (!updatedMessage) throw new Error(`Codex message ${messageId} not found`);
      return { state: { ...s, codexThreads }, result: updatedMessage };
    });
  }
}
