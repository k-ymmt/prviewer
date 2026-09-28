import { spawn, type ChildProcess } from 'node:child_process';
import { JsonRpcClient, type JsonRpcNotification, type JsonRpcServerRequest } from './jsonrpc.js';

export interface TurnHandlers {
  onDelta?: (delta: string) => void;
}

export interface TurnResult {
  text: string;
  status: 'completed' | 'interrupted' | 'failed';
  error: string | null;
}

export interface CodexClient {
  /** Starts a new thread and returns its id. */
  startThread(cwd: string): Promise<string>;
  /** Resumes an existing thread (or throws when it no longer exists). */
  resumeThread(threadId: string, cwd: string): Promise<void>;
  /** Runs one turn and resolves with the final agent message. */
  runTurn(threadId: string, prompt: string, handlers?: TurnHandlers): Promise<TurnResult>;
  dispose(): void;
}

export interface CodexAppServerOptions {
  command?: string;
  args?: string[];
  clientVersion?: string;
  /** Factory used by tests to substitute a fake transport. */
  connect?: () => Promise<{ client: JsonRpcClient; dispose: () => void }>;
  log?: (message: string) => void;
}

interface ThreadStartResponse {
  thread: { id: string };
}

interface TurnStartResponse {
  turn: { id: string };
}

interface TurnCompletedParams {
  threadId: string;
  turn: {
    id: string;
    status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
    error: { message: string } | null;
    items?: { type: string; id: string; text?: string }[];
  };
}

const READ_ONLY_THREAD_OPTIONS = {
  sandbox: 'read-only',
  approvalPolicy: 'never',
  ephemeral: false,
} as const;

/**
 * Manages a single long-lived `codex app-server` process over stdio.
 * The process is started lazily and restarted after it exits.
 */
export class CodexAppServer implements CodexClient {
  private connection: Promise<{ client: JsonRpcClient; dispose: () => void }> | null = null;
  private readonly log: (message: string) => void;

  constructor(private readonly options: CodexAppServerOptions = {}) {
    this.log = options.log ?? ((m) => console.error(`[codex] ${m}`));
  }

  private async getClient(): Promise<JsonRpcClient> {
    if (!this.connection) {
      this.connection = this.open().catch((error) => {
        this.connection = null;
        throw error;
      });
    }
    const { client } = await this.connection;
    return client;
  }

  private async open(): Promise<{ client: JsonRpcClient; dispose: () => void }> {
    const conn = this.options.connect ? await this.options.connect() : this.spawnProcess();
    const { client } = conn;
    client.on('request', (request: JsonRpcServerRequest) => this.handleServerRequest(client, request));
    client.on('protocolError', (error: Error) => this.log(error.message));
    client.on('close', () => {
      this.log('app-server connection closed');
      this.connection = null;
    });
    await client.request('initialize', {
      clientInfo: { name: 'prviewer', title: 'prviewer', version: this.options.clientVersion ?? '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    client.notify('initialized');
    return conn;
  }

  private spawnProcess(): { client: JsonRpcClient; dispose: () => void } {
    const command = this.options.command ?? 'codex';
    const args = this.options.args ?? ['app-server'];
    const child: ChildProcess = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.log(text);
    });
    if (!child.stdout || !child.stdin) {
      throw new Error('Failed to spawn codex app-server');
    }
    const client = new JsonRpcClient(child.stdout, child.stdin);
    child.on('exit', (code) => {
      client.close(new Error(`codex app-server exited with code ${code ?? 'null'}`));
    });
    child.on('error', (error) => {
      client.close(new Error(`codex app-server failed to start: ${error.message}`));
    });
    return {
      client,
      dispose: () => {
        child.kill();
      },
    };
  }

  private handleServerRequest(client: JsonRpcClient, request: JsonRpcServerRequest): void {
    // prviewer runs codex in a read-only sandbox with approvalPolicy=never, so approval requests
    // are unexpected. Decline anything that still shows up instead of blocking the turn forever.
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        client.respond(request.id, { decision: 'decline' });
        break;
      case 'execCommandApproval':
      case 'applyPatchApproval':
        client.respond(request.id, { decision: { denied: { rejection: 'prviewer runs codex read-only' } } });
        break;
      case 'item/permissions/requestApproval':
        client.respond(request.id, { decision: 'decline' });
        break;
      default:
        client.respondError(request.id, -32601, `prviewer does not handle ${request.method}`);
    }
  }

  async startThread(cwd: string): Promise<string> {
    const client = await this.getClient();
    const response = await client.request<ThreadStartResponse>('thread/start', { cwd, ...READ_ONLY_THREAD_OPTIONS });
    return response.thread.id;
  }

  async resumeThread(threadId: string, cwd: string): Promise<void> {
    const client = await this.getClient();
    await client.request('thread/resume', { threadId, cwd, ...READ_ONLY_THREAD_OPTIONS, excludeTurns: true });
  }

  async runTurn(threadId: string, prompt: string, handlers: TurnHandlers = {}): Promise<TurnResult> {
    const client = await this.getClient();
    return new Promise<TurnResult>((resolve, reject) => {
      let turnId: string | null = null;
      const messages = new Map<string, string>();
      let completedText: string | null = null;
      let currentItemId: string | null = null;

      const cleanup = () => {
        client.off('notification', onNotification);
        client.off('close', onClose);
      };
      const onClose = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onNotification = (n: JsonRpcNotification) => {
        const params = (n.params ?? {}) as Record<string, unknown>;
        if (params.threadId !== threadId) return;
        if (turnId && params.turnId !== undefined && params.turnId !== turnId) return;
        switch (n.method) {
          case 'item/agentMessage/delta': {
            const itemId = String(params.itemId);
            const delta = String(params.delta ?? '');
            if (currentItemId && currentItemId !== itemId && handlers.onDelta) {
              handlers.onDelta('\n\n');
            }
            currentItemId = itemId;
            messages.set(itemId, (messages.get(itemId) ?? '') + delta);
            handlers.onDelta?.(delta);
            break;
          }
          case 'item/completed': {
            const item = params.item as { type: string; id: string; text?: string } | undefined;
            if (item?.type === 'agentMessage') {
              messages.set(item.id, item.text ?? messages.get(item.id) ?? '');
              completedText = [...messages.values()].join('\n\n');
            }
            break;
          }
          case 'turn/completed': {
            const p = n.params as TurnCompletedParams;
            if (turnId && p.turn.id !== turnId) return;
            cleanup();
            const text = completedText ?? [...messages.values()].join('\n\n');
            if (p.turn.status === 'failed') {
              resolve({ text, status: 'failed', error: p.turn.error?.message ?? 'codex turn failed' });
            } else if (p.turn.status === 'interrupted') {
              resolve({ text, status: 'interrupted', error: 'codex turn was interrupted' });
            } else {
              resolve({ text, status: 'completed', error: null });
            }
            break;
          }
          case 'error': {
            const err = params.error as { message?: string } | undefined;
            if (params.willRetry) {
              this.log(`codex error (will retry): ${err?.message ?? 'unknown'}`);
            }
            break;
          }
          default:
            break;
        }
      };

      client.on('notification', onNotification);
      client.on('close', onClose);
      client
        .request<TurnStartResponse>('turn/start', {
          threadId,
          input: [{ type: 'text', text: prompt, text_elements: [] }],
        })
        .then((response) => {
          turnId = response.turn.id;
        })
        .catch((error: Error) => {
          cleanup();
          reject(error);
        });
    });
  }

  dispose(): void {
    if (!this.connection) return;
    void this.connection.then(({ dispose }) => dispose()).catch(() => undefined);
    this.connection = null;
  }
}
